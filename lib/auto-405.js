/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var parseUrl = require('parseurl');
var { Buffer } = require('node:buffer');

/**
 * Module variables.
 * @private
 */

var kRecordedMethods = Symbol('express:auto-405:methods');

/**
 * Wrap the final `done` callback of an application dispatch to respond
 * with "405 Method Not Allowed" when the request matched one or more
 * route paths, but none of the matching routes handle the request
 * method, and nothing else responded.
 *
 * Methods recorded by mounted routers created with `express.Router()`
 * are merged into the generated `Allow` header.
 *
 * @param {Router} router the application router to inspect
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {Function} done the original final callback
 * @return {Function}
 * @private
 */

exports.wrapDone = function wrapDone(router, req, res, done) {
  return function auto405(err) {
    if (err == null && !res.headersSent) {
      var result = inspectRouter(router, req);

      if (!result.handled) {
        var methods = mergeMethods(result.methods, getRecordedMethods(req));

        if (methods.length !== 0) {
          sendMethodNotAllowed(req, res, methods);
          return;
        }
      }
    }

    done.apply(this, arguments);
  };
};

/**
 * Wrap the `handle` method of a router created with `express.Router()`
 * to participate in automatic 405 handling.
 *
 * When `respond` is `true` (the router was created with the `auto405`
 * option), the router itself responds with "405 Method Not Allowed"
 * when a request would fall through it unhandled while a route path
 * matched but the request method is not handled.
 *
 * Otherwise, when the application handling the request has the
 * "auto 405" setting enabled, the router records the methods of
 * path-matching routes on the request, so the application can build
 * a complete `Allow` header if the request falls through entirely.
 *
 * @param {Router} router the router instance to wrap
 * @param {Boolean} respond respond with 405 from this router
 * @return {Router} the wrapped router
 * @private
 */

exports.wrapRouter = function wrapRouter(router, respond) {
  var handle = router.handle;

  router.handle = function handleWithAuto405(req, res, out) {
    var self = this;

    handle.call(this, req, res, function auto405(err) {
      if (err == null && !res.headersSent) {
        if (respond) {
          var result = inspectRouter(self, req);

          if (result.matched && !result.handled) {
            sendMethodNotAllowed(req, res, result.methods);
            return;
          }
        } else if (isAuto405Enabled(req)) {
          var inspected = inspectRouter(self, req);

          if (inspected.matched && !inspected.handled) {
            recordMethods(req, inspected.methods);
          }
        }
      }

      out.apply(this, arguments);
    });
  };

  return router;
};

/**
 * Inspect the route layers of `router` for the request path.
 *
 * Returns an object describing whether any route path matched the
 * request path (`matched`), whether any of the matching routes handle
 * the request method (`handled`), and the sorted list of methods the
 * matching routes do handle (`methods`).
 *
 * @param {Router} router
 * @param {IncomingMessage} req
 * @return {Object}
 * @private
 */

function inspectRouter(router, req) {
  var result = { matched: false, handled: false, methods: [] };

  var pathname;

  try {
    pathname = parseUrl(req).pathname;
  } catch (err) {
    return result;
  }

  if (pathname == null) {
    return result;
  }

  var method = req.method;
  var seen = Object.create(null);
  var stack = router.stack;

  for (var i = 0; i < stack.length; i++) {
    var layer = stack[i];
    var route = layer.route;

    if (!route) {
      continue;
    }

    var match;

    try {
      match = layer.match(pathname);
    } catch (err) {
      continue;
    }

    if (match !== true) {
      continue;
    }

    result.matched = true;

    if (route._handlesMethod(method)) {
      // a route for this path handles the request method,
      // so the request can never be a 405 for this router
      result.handled = true;
      result.methods = [];
      return result;
    }

    var methods = route._methods();

    for (var j = 0; j < methods.length; j++) {
      var name = methods[j];

      if (name === '_ALL' || seen[name]) {
        continue;
      }

      seen[name] = true;
      result.methods.push(name);
    }
  }

  result.methods.sort();
  return result;
}

/**
 * Check if the application handling the request enabled "auto 405".
 *
 * @param {IncomingMessage} req
 * @return {Boolean}
 * @private
 */

function isAuto405Enabled(req) {
  var app = req.app;
  return Boolean(app) && typeof app.enabled === 'function' && app.enabled('auto 405');
}

/**
 * Record allowed methods on the request for later aggregation.
 *
 * @param {IncomingMessage} req
 * @param {Array} methods
 * @private
 */

function recordMethods(req, methods) {
  var recorded = req[kRecordedMethods];

  if (!recorded) {
    recorded = req[kRecordedMethods] = Object.create(null);
  }

  for (var i = 0; i < methods.length; i++) {
    recorded[methods[i]] = true;
  }
}

/**
 * Get the methods recorded on the request by mounted routers.
 *
 * @param {IncomingMessage} req
 * @return {Array}
 * @private
 */

function getRecordedMethods(req) {
  var recorded = req[kRecordedMethods];
  return recorded ? Object.keys(recorded) : [];
}

/**
 * Merge two method name lists into a single sorted list.
 *
 * @param {Array} a
 * @param {Array} b
 * @return {Array}
 * @private
 */

function mergeMethods(a, b) {
  if (a.length === 0) {
    return b.slice().sort();
  }

  if (b.length === 0) {
    return a;
  }

  var seen = Object.create(null);
  var methods = [];

  for (var i = 0; i < a.length; i++) {
    seen[a[i]] = true;
    methods.push(a[i]);
  }

  for (var j = 0; j < b.length; j++) {
    if (!seen[b[j]]) {
      methods.push(b[j]);
    }
  }

  return methods.sort();
}

/**
 * Send a "405 Method Not Allowed" response.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {Array} methods sorted list of allowed methods
 * @private
 */

function sendMethodNotAllowed(req, res, methods) {
  var body = 'Method Not Allowed';

  res.statusCode = 405;
  res.setHeader('Allow', methods.join(', '));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(req.method === 'HEAD' ? undefined : body);
}
