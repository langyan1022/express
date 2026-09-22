'use strict'

var express = require('../')
  , request = require('supertest')
  , assert = require('node:assert');

describe('auto 405', function(){
  describe('when disabled (default)', function(){
    it('should respond 404 when the method is not registered', function(done){
      var app = express();

      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .post('/users')
      .expect(404, done);
    })

    it('should not include an Allow header', function(done){
      var app = express();

      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .post('/users')
      .expect(function(res){
        assert.strictEqual(res.headers.allow, undefined);
      })
      .expect(404, done);
    })
  })

  describe('when enabled with app.enable("auto 405")', function(){
    it('should respond 405 with Allow when the path matches but the method does not', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .post('/users')
      .expect('Allow', 'GET, HEAD')
      .expect('Content-Type', 'text/plain; charset=utf-8')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect(405, 'Method Not Allowed', done);
    })

    it('should respond 404 when no path matches', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .post('/other')
      .expect(function(res){
        assert.strictEqual(res.headers.allow, undefined);
      })
      .expect(404, done);
    })

    it('should respond 404 for paths that only partially match', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.get('/user/:id', function(req, res){ res.end('ok'); });

      request(app)
      .post('/userss')
      .expect(404, function(err){
        if (err) return done(err);

        request(app)
        .post('/user')
        .expect(404, done);
      });
    })

    it('should match paths according to the strict routing setting', function(done){
      var app = express();

      app.enable('auto 405');
      app.enable('strict routing');
      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .post('/users/')
      .expect(404, done);
    })

    it('should aggregate methods from multiple routes with the same path', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.post('/users', function(req, res){ res.end('ok'); });
      app.get('/users', function(req, res){ res.end('ok'); });

      request(app)
      .put('/users')
      .expect('Allow', 'GET, HEAD, POST')
      .expect(405, done);
    })

    it('should not leak methods registered for other paths', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.delete('/other', function(req, res){ res.end('ok'); });

      request(app)
      .put('/users')
      .expect('Allow', 'GET, HEAD')
      .expect(405, done);
    })

    it('should match dynamic parameters before responding 405', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/user/:id', function(req, res){ res.end('ok'); });

      request(app)
      .post('/user/42')
      .expect('Allow', 'GET, HEAD')
      .expect(405, function(err){
        if (err) return done(err);

        request(app)
        .post('/user')
        .expect(404, done);
      });
    })

    it('should not respond 405 for methods handled through app.all()', function(done){
      var app = express();

      app.enable('auto 405');
      app.all('/users', function(req, res){ res.end('ok'); });

      request(app)
      .delete('/users')
      .expect(200, 'ok', done);
    })

    it('should not respond 405 when a matching route handles the method but declines', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res, next){ next(); });

      request(app)
      .get('/users')
      .expect(404, done);
    })

    it('should continue to the next route on next("route")', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res, next){ next('route'); });
      app.get('/users', function(req, res){ res.end('second'); });

      request(app)
      .get('/users')
      .expect(200, 'second', function(err){
        if (err) return done(err);

        request(app)
        .put('/users')
        .expect('Allow', 'GET, HEAD')
        .expect(405, done);
      });
    })

    it('should run middleware after the route before responding 405', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.use(function(req, res, next){
        res.setHeader('x-after', '1');
        next();
      });

      request(app)
      .post('/users')
      .expect('x-after', '1')
      .expect('Allow', 'GET, HEAD')
      .expect(405, done);
    })

    it('should let a user-defined 404 handler take precedence', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.use(function(req, res){
        res.status(404).send('custom not found');
      });

      request(app)
      .post('/users')
      .expect(function(res){
        assert.strictEqual(res.headers.allow, undefined);
      })
      .expect(404, 'custom not found', done);
    })

    it('should let a user-defined 405 handler take precedence', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.use(function(req, res, next){
        if (req.method !== 'GET') {
          return res.status(405).set('Allow', 'GET').send('custom');
        }
        next();
      });

      request(app)
      .post('/users')
      .expect('Allow', 'GET')
      .expect(405, 'custom', done);
    })

    it('should not respond 405 when the response was already sent', function(done){
      var app = express();

      app.enable('auto 405');
      app.get('/users', function(req, res){ res.end('ok'); });
      app.use(function(req, res, next){
        res.status(418).end('teapot');
        next();
      });

      request(app)
      .post('/users')
      .expect(418, 'teapot', done);
    })

    describe('HEAD requests', function(){
      it('should handle HEAD through GET routes', function(done){
        var app = express();

        app.enable('auto 405');
        app.get('/users', function(req, res){ res.end('ok'); });

        request(app)
        .head('/users')
        .expect(200, done);
      })

      it('should respond 405 without a body when HEAD is not handled', function(done){
        var app = express();

        app.enable('auto 405');
        app.post('/users', function(req, res){ res.end('ok'); });

        request(app)
        .head('/users')
        .expect('Allow', 'POST')
        .expect('Content-Length', '18')
        .expect(function(res){
          assert.strictEqual(res.text, undefined);
        })
        .expect(405, done);
      })
    })

    describe('OPTIONS requests', function(){
      it('should keep the automatic OPTIONS response', function(done){
        var app = express();

        app.enable('auto 405');
        app.get('/users', function(req, res){ res.end('ok'); });
        app.put('/users', function(req, res){ res.end('ok'); });

        request(app)
        .options('/users')
        .expect('Allow', 'GET, HEAD, PUT')
        .expect(200, 'GET, HEAD, PUT', done);
      })

      it('should respond 404 for OPTIONS when no path matches', function(done){
        var app = express();

        app.enable('auto 405');
        app.get('/users', function(req, res){ res.end('ok'); });

        request(app)
        .options('/other')
        .expect(404, done);
      })
    })

    describe('error handling', function(){
      it('should run error middleware instead of responding 405', function(done){
        var app = express();

        app.enable('auto 405');
        app.get('/users', function(req, res, next){
          next(new Error('boom'));
        });
        app.use(function(err, req, res, next){
          res.status(500).send('handled: ' + err.message);
        });

        request(app)
        .get('/users')
        .expect(500, 'handled: boom', done);
      })

      it('should pass errors through to the final handler', function(done){
        var app = express();

        app.enable('auto 405');
        app.get('/users', function(req, res, next){
          next(new Error('boom'));
        });

        request(app)
        .get('/users')
        .expect(function(res){
          assert.strictEqual(res.headers.allow, undefined);
        })
        .expect(500, done);
      })

      it('should respond 405 when error middleware recovers and nothing handles the method', function(done){
        var app = express();

        app.enable('auto 405');
        app.use(function(req, res, next){
          next(new Error('boom'));
        });
        app.get('/users', function(req, res){ res.end('ok'); });
        app.use(function(err, req, res, next){
          next();
        });

        request(app)
        .post('/users')
        .expect('Allow', 'GET, HEAD')
        .expect(405, done);
      })
    })

    describe('mounted routers', function(){
      it('should include methods from mounted express.Router() instances', function(done){
        var app = express();
        var router = express.Router();

        app.enable('auto 405');

        router.get('/users', function(req, res){ res.end('ok'); });
        router.post('/users', function(req, res){ res.end('ok'); });

        app.use('/api', router);

        request(app)
        .put('/api/users')
        .expect('Allow', 'GET, HEAD, POST')
        .expect(405, done);
      })

      it('should aggregate methods across routers mounted on the same path', function(done){
        var app = express();
        var router1 = express.Router();
        var router2 = express.Router();

        app.enable('auto 405');

        router1.get('/users', function(req, res){ res.end('ok'); });
        router2.post('/users', function(req, res){ res.end('ok'); });

        app.use(router1);
        app.use(router2);

        request(app)
        .put('/users')
        .expect('Allow', 'GET, HEAD, POST')
        .expect(405, done);
      })

      it('should respond 404 when mounted routers have no matching path', function(done){
        var app = express();
        var router = express.Router();

        app.enable('auto 405');

        router.get('/users', function(req, res){ res.end('ok'); });

        app.use('/api', router);

        request(app)
        .put('/api/other')
        .expect(404, done);
      })

      it('should continue routing when a later route handles the method', function(done){
        var app = express();
        var router = express.Router();

        app.enable('auto 405');

        router.get('/users', function(req, res){ res.end('ok'); });

        app.use('/api', router);
        app.post('/api/users', function(req, res){ res.end('app route'); });

        request(app)
        .post('/api/users')
        .expect(200, 'app route', done);
      })

      it('should respond 405 from mounted sub-apps inheriting the setting', function(done){
        var app = express();
        var sub = express();

        app.enable('auto 405');

        sub.get('/users', function(req, res){ res.end('ok'); });

        app.use('/api', sub);

        request(app)
        .put('/api/users')
        .expect('Allow', 'GET, HEAD')
        .expect(405, done);
      })
    })
  })

  describe('when enabled with express.Router of auto405 option', function(){
    it('should respond 405 from the router itself', function(done){
      var app = express();
      var router = express.Router({ auto405: true });

      router.get('/users', function(req, res){ res.end('ok'); });

      app.use('/api', router);

      request(app)
      .put('/api/users')
      .expect('Allow', 'GET, HEAD')
      .expect(405, 'Method Not Allowed', done);
    })

    it('should fall through when no router path matches', function(done){
      var app = express();
      var router = express.Router({ auto405: true });

      router.get('/users', function(req, res){ res.end('ok'); });

      app.use('/api', router);

      request(app)
      .put('/api/other')
      .expect(404, done);
    })

    it('should fall through when a matching route handles the method', function(done){
      var app = express();
      var router = express.Router({ auto405: true });

      router.get('/users', function(req, res, next){ next('route'); });

      app.use('/api', router);
      app.use(function(req, res){
        res.status(404).send('custom not found');
      });

      request(app)
      .get('/api/users')
      .expect(404, 'custom not found', done);
    })

    it('should not handle HEAD through GET routes of other paths', function(done){
      var app = express();
      var router = express.Router({ auto405: true });

      router.post('/users', function(req, res){ res.end('ok'); });

      app.use('/api', router);

      request(app)
      .head('/api/users')
      .expect('Allow', 'POST')
      .expect(405, done);
    })

    it('should keep the automatic OPTIONS response', function(done){
      var app = express();
      var router = express.Router({ auto405: true });

      router.get('/users', function(req, res){ res.end('ok'); });

      app.use('/api', router);

      request(app)
      .options('/api/users')
      .expect('Allow', 'GET, HEAD')
      .expect(200, 'GET, HEAD', done);
    })
  })
})
