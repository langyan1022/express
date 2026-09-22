'use strict'

var after = require('after');
var assert = require('node:assert')
var express = require('..');
var request = require('supertest');

describe('app', function(){
  describe('.handle(req, res, callback)', function(){
    describe('when mounted on a router', function(){
      it('should use the sub-app semantics inside the sub-app', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.get('/hello', function(req, res){
          assert.strictEqual(req.app, sub)
          assert.strictEqual(Object.getPrototypeOf(req), sub.request)
          assert.strictEqual(Object.getPrototypeOf(res), sub.response)
          res.send('hello from sub')
        })

        router.use('/sub', sub)
        app.use(router)

        request(app)
          .get('/sub/hello')
          .expect(200, 'hello from sub', done)
      })

      it('should restore the outer prototypes when the sub-app calls next()', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          next()
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        request(app)
          .get('/sub/anything')
          .expect(200, 'outer', done)
      })

      it('should restore the outer trust proxy policy when the sub-app calls next()', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()
        var ips = {}

        app.enable('trust proxy')

        sub.use(function(req, res, next){
          ips.sub = req.ip
          next()
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(req, res){
          ips.outer = req.ip
          res.end('ok')
        })

        request(app)
          .get('/sub/x')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect(200, function(err){
            if (err) return done(err)
            assert.match(ips.sub, /127\.0\.0\.1$/)
            assert.strictEqual(ips.outer, 'client')
            done()
          })
      })

      it('should restore the outer prototypes when the sub-app passes an error', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          next(new Error('boom'))
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(err, req, res, next){
          assert.strictEqual(err.message, 'boom')
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.status(500).end('outer error')
        })

        request(app)
          .get('/sub/x')
          .expect(500, 'outer error', done)
      })

      it('should restore the outer prototypes when the sub-app throws', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          throw new Error('boom')
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(err, req, res, next){
          assert.strictEqual(err.message, 'boom')
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          res.status(500).end('outer error')
        })

        request(app)
          .get('/sub/x')
          .expect(500, 'outer error', done)
      })

      it('should restore the outer prototypes when an async sub-app middleware rejects', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(async function(req, res, next){
          throw new Error('boom')
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(err, req, res, next){
          assert.strictEqual(err.message, 'boom')
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          res.status(500).end('outer error')
        })

        request(app)
          .get('/sub/x')
          .expect(500, 'outer error', done)
      })

      it('should run the sub-app error middleware with sub-app semantics', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          next(new Error('boom'))
        })

        sub.use(function(err, req, res, next){
          assert.strictEqual(err.message, 'boom')
          assert.strictEqual(req.app, sub)
          assert.strictEqual(Object.getPrototypeOf(req), sub.request)
          assert.strictEqual(Object.getPrototypeOf(res), sub.response)
          res.status(502).end('sub error')
        })

        router.use('/sub', sub)
        app.use(router)

        request(app)
          .get('/sub/x')
          .expect(502, 'sub error', done)
      })

      it('should restore the outer prototypes on next(\'router\')', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          next('router')
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        request(app)
          .get('/sub/x')
          .expect(200, 'outer', done)
      })

      it('should restore the outer prototypes when headers are already sent', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()

        sub.use(function(req, res, next){
          res.writeHead(200, { 'x-sub': 'hit' })
          next()
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(req, res){
          assert.strictEqual(res.headersSent, true)
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        request(app)
          .get('/sub/x')
          .expect('x-sub', 'hit')
          .expect(200, 'outer', done)
      })

      it('should restore the prototypes through multiple mount levels', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()
        var inner = express()

        inner.use(function(req, res, next){
          assert.strictEqual(req.app, inner)
          assert.strictEqual(Object.getPrototypeOf(req), inner.request)
          next()
        })

        sub.use('/inner', inner)

        sub.use(function(req, res, next){
          // back from the inner app, sub semantics are restored
          assert.strictEqual(req.app, sub)
          assert.strictEqual(Object.getPrototypeOf(req), sub.request)
          assert.strictEqual(Object.getPrototypeOf(res), sub.response)
          next()
        })

        router.use('/sub', sub)
        app.use(router)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        request(app)
          .get('/sub/inner/x')
          .expect(200, 'outer', done)
      })

      it('should restore the prototypes when the same app is mounted more than once', function(done){
        var app = express()
        var router = express.Router()
        var sub = express()
        var calls = 0

        sub.use(function(req, res, next){
          calls++
          assert.strictEqual(req.app, sub)
          next()
        })

        router.use('/a', sub)
        router.use('/b', sub)
        app.use(router)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          res.end('outer')
        })

        var cb = after(2, function(){
          assert.strictEqual(calls, 2)
          done()
        })

        request(app).get('/a/x').expect(200, 'outer', cb)
        request(app).get('/b/x').expect(200, 'outer', cb)
      })

      it('should isolate restoration between concurrent requests', function(done){
        var app = express()
        var sub = express()

        sub.use(function(req, res, next){
          // hold the request inside the sub-app so both
          // requests are within the mount boundary together
          setTimeout(next, 10)
        })

        app.use('/sub', sub)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        var cb = after(2, done)

        request(app).get('/sub/1').expect(200, 'outer', cb)
        request(app).get('/sub/2').expect(200, 'outer', cb)
      })
    })

    describe('when mounted on an app', function(){
      it('should restore the outer prototypes when the sub-app calls next()', function(done){
        var app = express()
        var sub = express()

        sub.use(function(req, res, next){
          assert.strictEqual(req.app, sub)
          next()
        })

        app.use('/sub', sub)

        app.use(function(req, res){
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          assert.strictEqual(Object.getPrototypeOf(res), app.response)
          res.end('outer')
        })

        request(app)
          .get('/sub/x')
          .expect(200, 'outer', done)
      })

      it('should keep distinct trust proxy policies on both sides of the boundary', function(done){
        var app = express()
        var sub = express()
        var ips = {}

        app.enable('trust proxy')
        sub.set('trust proxy', false)

        sub.use(function(req, res, next){
          ips.sub = req.ip
          next()
        })

        app.use('/sub', sub)

        app.use(function(req, res){
          ips.outer = req.ip
          res.end('ok')
        })

        request(app)
          .get('/sub/x')
          .set('X-Forwarded-For', 'client, p1, p2')
          .expect(200, function(err){
            if (err) return done(err)
            assert.match(ips.sub, /127\.0\.0\.1$/)
            assert.strictEqual(ips.outer, 'client')
            done()
          })
      })

      it('should propagate sub-app errors to the outer error middleware', function(done){
        var app = express()
        var sub = express()

        sub.use(function(req, res, next){
          next(new Error('boom'))
        })

        app.use('/sub', sub)

        app.use(function(err, req, res, next){
          assert.strictEqual(err.message, 'boom')
          assert.strictEqual(req.app, app)
          assert.strictEqual(Object.getPrototypeOf(req), app.request)
          res.status(500).end('outer error')
        })

        request(app)
          .get('/sub/x')
          .expect(500, 'outer error', done)
      })

      it('should still emit "mount" and inherit from the parent', function(){
        var app = express()
        var sub = express()
        var mounted = null

        app.enable('trust proxy')

        sub.on('mount', function(parent){
          mounted = parent
        })

        app.use('/sub', sub)

        assert.strictEqual(mounted, app)
        assert.strictEqual(sub.parent, app)
        assert.strictEqual(sub.mountpath, '/sub')
        // inherited prototypes and settings
        assert.strictEqual(Object.getPrototypeOf(sub.request), app.request)
        assert.strictEqual(Object.getPrototypeOf(sub.response), app.response)
        assert.strictEqual(sub.get('trust proxy fn'), app.get('trust proxy fn'))
      })
    })
  })
})
