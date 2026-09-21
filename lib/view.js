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

var debug = require('debug')('express:view');
var path = require('node:path');
var fs = require('node:fs');

/**
 * Module variables.
 * @private
 */

var basename = path.basename;
var extname = path.extname;
var join = path.join;
var posix = path.posix;
var win32 = path.win32;

// path semantics of the host platform; POSIX semantics are additionally used
// when validating Windows-style names on POSIX hosts
var platformPath = process.platform === 'win32' ? win32 : posix;

// Windows drive-rooted ("C:\") and UNC ("\\server\share") paths.
var WINDOWS_ROOT_REGEXP = /^(?:[a-zA-Z]:[\\/]|\\\\|\/\/)/;

/**
 * Module exports.
 * @public
 */

module.exports = View;

/**
 * Initialize a new `View` with the given `name`.
 *
 * Options:
 *
 *   - `defaultEngine` the default template engine name
 *   - `engines` template engine require() cache
 *   - `root` root path for view lookup
 *
 * @param {string} name
 * @param {object} options
 * @public
 */

function View(name, options) {
  var opts = options || {};

  this.defaultEngine = opts.defaultEngine;
  this.name = name;
  this.root = opts.root;

  // set when the name resolves outside of every configured root
  this.escapedRoot = false;

  // normalize for extension detection so mixed separators on POSIX do not
  // hide the real extension
  var normalized = normalizeName(name);
  var ext = normalized === undefined ? '' : extname(normalized);

  if (!ext && !this.defaultEngine) {
    throw new Error('No default engine was specified and no extension was provided.');
  }

  this.ext = ext || inferredExtension(this.defaultEngine);

  var fileName = name;

  if (!ext) {
    fileName += this.ext;
  }

  // lookup the path before loading the engine so that an untrusted name can
  // neither escape the views root nor influence the engine module required
  this.path = this.lookup(fileName);

  // no file could be located; leave the engine unloaded to avoid requiring a
  // module derived from an untrusted name
  if (!this.path) {
    this.engine = null;
    return;
  }

  if (!opts.engines[this.ext]) {
    // load engine
    var mod = this.ext.slice(1)
    debug('require "%s"', mod)

    // default engine export
    var fn = require(mod).__express

    if (typeof fn !== 'function') {
      throw new Error('Module "' + mod + '" does not provide a view engine.')
    }

    opts.engines[this.ext] = fn
  }

  // store loaded engine
  this.engine = opts.engines[this.ext];

}

/**
 * Lookup view by the given `name`
 *
 * @param {string} name
 * @private
 */

View.prototype.lookup = function lookup(name) {
  var path;
  var roots = [].concat(this.root);

  debug('lookup "%s"', name);

  // decode percent-encoded separators and treat both "/" and "\" as
  // separators so Windows-style and mixed separators cannot bypass the
  // containment check on POSIX hosts
  var fileName = normalizeName(name);

  if (fileName === undefined) {
    return undefined;
  }

  // a drive letter or UNC share is a different volume from every root
  if (WINDOWS_ROOT_REGEXP.test(fileName)) {
    this.escapedRoot = true;
    return undefined;
  }

  // an absolute path can only be used when it points inside a root
  var absolute = platformPath.isAbsolute(fileName);

  // track whether the name escapes each root rather than merely missing a file
  var containedByRoot = false;

  for (var i = 0; i < roots.length && !path; i++) {
    var root = roots[i];

    var loc = process.platform === 'win32'
      ? win32.resolve(root, fileName)
      : (absolute
        ? posix.resolve(fileName)
        : posix.resolve(toPosix(root), fileName));

    // containment is decided after normalization, segment by segment
    if (!containsPath(root, loc)) {
      continue;
    }

    containedByRoot = true;
    path = this.resolve(platformPath.dirname(loc), platformPath.basename(loc));
  }

  // a name that normalizes outside of every configured root is a containment
  // violation rather than a missing template; a name contained by at least
  // one root is simply missing when no file exists there
  if (!path && !containedByRoot) {
    this.escapedRoot = true;
  }

  return path;
};

/**
 * Render with the given options.
 *
 * @param {object} options
 * @param {function} callback
 * @private
 */

View.prototype.render = function render(options, callback) {
  var sync = true;

  debug('render "%s"', this.path);

  // render, normalizing sync callbacks
  this.engine(this.path, options, function onRender() {
    if (!sync) {
      return callback.apply(this, arguments);
    }

    // copy arguments
    var args = new Array(arguments.length);
    var cntx = this;

    for (var i = 0; i < arguments.length; i++) {
      args[i] = arguments[i];
    }

    // force callback to be async
    return process.nextTick(function renderTick() {
      return callback.apply(cntx, args);
    });
  });

  sync = false;
};

/**
 * Resolve the file within the given directory.
 *
 * @param {string} dir
 * @param {string} file
 * @private
 */

View.prototype.resolve = function resolve(dir, file) {
  var ext = this.ext;

  // <path>.<ext>
  var path = join(dir, file);
  var stat = tryStat(path);

  if (stat && stat.isFile()) {
    return path;
  }

  // <path>/index.<ext>
  path = join(dir, basename(file, ext), 'index' + ext);
  stat = tryStat(path);

  if (stat && stat.isFile()) {
    return path;
  }
};

/**
 * Return a stat, maybe.
 *
 * @param {string} path
 * @return {fs.Stats}
 * @private
 */

function tryStat(path) {
  debug('stat "%s"', path);

  try {
    return fs.statSync(path);
  } catch (e) {
    return undefined;
  }
}

/**
 * Percent-decode a view name.
 *
 * Returns undefined when the name contains malformed escape sequences; such
 * a name can never identify a real file, so lookup simply fails.
 *
 * @param {string} name
 * @return {string|undefined}
 * @private
 */

function safeDecode(name) {
  try {
    return decodeURIComponent(name);
  } catch (e) {
    return undefined;
  }
}

/**
 * Decode and separator-normalize a view name.
 *
 * Percent-encoded separators and "." segments (e.g. "%2e%2e%2f") are
 * decoded, and backslashes are treated as separators so Windows-style and
 * mixed-separator names cannot bypass containment on POSIX hosts.
 *
 * Returns undefined for malformed percent-encoding or embedded null bytes;
 * such names can never identify a real file.
 *
 * @param {string} name
 * @return {string|undefined}
 * @private
 */

function normalizeName(name) {
  var decoded = safeDecode(name);

  if (decoded === undefined || decoded.indexOf('\0') !== -1) {
    return undefined;
  }

  return decoded.replace(/\\/g, '/');
}

/**
 * Get the file extension implied by a default engine setting.
 *
 * @param {string} engine
 * @return {string}
 * @private
 */

function inferredExtension(engine) {
  return engine[0] !== '.'
    ? '.' + engine
    : engine;
}

/**
 * Convert a platform path to a POSIX-style path for normalized comparison.
 *
 * @param {string} file
 * @return {string}
 * @private
 */

function toPosix(file) {
  return file.replace(/\\/g, '/');
}

/**
 * Check whether `loc` is the same as, or a descendant of, `root`.
 *
 * Both paths are normalized and compared as complete path segments after
 * platform case folding, so case differences, separator styles and
 * prefix-similar names (e.g. root "/srv/views" vs. "/srv/views-evil")
 * cannot bypass containment.
 *
 * Security boundary: this is a lexical check performed before any file is
 * read. A symlink already placed inside the root can therefore still point
 * outside of it; protecting against that requires running the views root on
 * a volume where untrusted users cannot create symlinks (the same boundary
 * `sendFile` documents for static roots).
 *
 * @param {string} root configured views root
 * @param {string} loc normalized absolute POSIX-style candidate
 * @return {boolean}
 * @private
 */

function containsPath(root, loc) {
  var rootParts = segments(path.resolve(root));
  var locParts = segments(loc);

  if (locParts.length < rootParts.length) {
    return false;
  }

  for (var i = 0; i < rootParts.length; i++) {
    if (fold(rootParts[i]) !== fold(locParts[i])) {
      return false;
    }
  }

  return true;
}

/**
 * Split a normalized host or POSIX-style path into comparison segments.
 *
 * Drive letters and UNC roots survive as the first segment, so candidates on
 * a different volume can never be considered contained.
 *
 * @param {string} file
 * @return {string[]}
 * @private
 */

function segments(file) {
  return toPosix(file).split('/').filter(Boolean);
}

/**
 * Fold a single path segment for comparison using platform case rules.
 *
 * @param {string} segment
 * @return {string}
 * @private
 */

function fold(segment) {
  return process.platform === 'win32'
    ? segment.toLowerCase()
    : segment;
}
