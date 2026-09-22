'use strict'

var assert = require('node:assert')
var express = require('..')
var request = require('supertest')

describe('app.handle() mounted app boundary', function () {
  it('should restore outer prototypes after a mounted app calls next()', function (done) {
    var app = express()
    var sub = express()
    var innerApiWorked = false

    sub.use(function (req, res, next) {
      // the mounted app provides its own request/response api
      assert.strictEqual(typeof req.accepts, 'function')
      assert.strictEqual(typeof res.json, 'function')
      assert.strictEqual(Object.getPrototypeOf(req), sub.request)
      assert.strictEqual(Object.getPrototypeOf(res), sub.response)
      innerApiWorked = true
      next()
    })

    // mount the express app directly onto a plain router, bypassing the
    // app.use() mount wrapper
    var router = new express.Router()
    router.use(sub)
    app.use(router)

    app.use(function (req, res) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(Object.getPrototypeOf(res), app.response)
      assert.strictEqual(req.app, app)
      res.json({ restored: true })
    })

    request(app)
      .get('/')
      .expect(200, { restored: true })
      .end(function (err) {
        if (err) return done(err)
        assert.ok(innerApiWorked)
        done()
      })
  })

  it('should restore outer trust proxy policy after next(err)', function (done) {
    var app = express()
    var sub = express()

    app.set('trust proxy', '10.0.0.0')
    sub.set('trust proxy', '192.168.0.0')

    sub.use(function (req, res, next) {
      assert.strictEqual(req.app.get('trust proxy'), '192.168.0.0')
      next(new Error('boom'))
    })

    var router = new express.Router()
    router.use(sub)
    app.use(router)

    app.use(function (err, req, res, next) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(req.app, app)
      assert.strictEqual(req.app.get('trust proxy'), '10.0.0.0')
      res.status(500).json({ error: err.message })
    })

    request(app)
      .get('/')
      .expect(500, { error: 'boom' }, done)
  })

  it('should restore outer semantics after a synchronous throw', function (done) {
    var app = express()
    var sub = express()

    app.set('trust proxy', false)
    sub.set('trust proxy', '192.168.0.0')

    sub.use(function () {
      throw new Error('sync boom')
    })

    var router = new express.Router()
    router.use(sub)
    app.use(router)

    app.use(function (err, req, res, next) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(req.app.get('trust proxy'), false)
      res.status(500).json({ error: err.message })
    })

    request(app)
      .get('/')
      .expect(500, { error: 'sync boom' }, done)
  })

  it('should restore outer semantics after an asynchronous rejection', function (done) {
    var app = express()
    var sub = express()

    sub.set('trust proxy', '192.168.0.0')

    sub.use(function () {
      return Promise.reject(new Error('async boom'))
    })

    var router = new express.Router()
    router.use(sub)
    app.use(router)

    app.use(function (err, req, res, next) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(req.app, app)
      res.status(500).json({ error: err.message })
    })

    request(app)
      .get('/')
      .expect(500, { error: 'async boom' }, done)
  })

  it('should restore outer semantics after next("router") inside the sub app', function (done) {
    var app = express()
    var sub = express()
    var skipped = false

    sub.use(function (req, res, next) {
      next('router')
    })
    sub.use(function () {
      skipped = true
      throw new Error('should never run')
    })

    var router = new express.Router()
    router.use(sub)
    app.use(router)

    app.use(function (req, res) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      res.json({ reached: true })
    })

    request(app)
      .get('/')
      .expect(200, { reached: true })
      .end(function (err) {
        if (err) return done(err)
        assert.strictEqual(skipped, false)
        done()
      })
  })

  it('should restore outer semantics across multiple mounted levels', function (done) {
    var app = express()
    var sub = express()
    var subsub = express()

    app.set('trust proxy', '10.0.0.0')
    sub.set('trust proxy', '172.16.0.0')
    subsub.set('trust proxy', '192.168.0.0')

    subsub.use(function (req, res, next) {
      assert.strictEqual(req.app.get('trust proxy'), '192.168.0.0')
      assert.strictEqual(Object.getPrototypeOf(req), subsub.request)
      next(new Error('deep boom'))
    })

    var innerRouter = new express.Router()
    innerRouter.use(subsub)
    sub.use('/s', innerRouter)

    sub.use(function (err, req, res, next) {
      // the sub app's error middleware keeps the sub app semantics
      assert.strictEqual(Object.getPrototypeOf(req), sub.request)
      assert.strictEqual(req.app.get('trust proxy'), '172.16.0.0')
      next(err)
    })

    var outerRouter = new express.Router()
    outerRouter.use(sub)
    app.use('/a', outerRouter)

    app.use(function (err, req, res, next) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(req.app, app)
      assert.strictEqual(req.app.get('trust proxy'), '10.0.0.0')
      assert.strictEqual(req.baseUrl, '')
      res.status(500).json({ error: err.message })
    })

    request(app)
      .get('/a/s/')
      .expect(500, { error: 'deep boom' }, done)
  })

  it('should keep restoring boundaries when the same sub app is entered twice', function (done) {
    var app = express()
    var sub = express()
    var entries = []

    sub.use(function (req, res, next) {
      entries.push(Object.getPrototypeOf(req) === sub.request)
      next()
    })

    var router1 = new express.Router()
    var router2 = new express.Router()
    router1.use(sub)
    router2.use(sub)

    app.use(router1, router2, function (req, res) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      res.json({ entries: entries })
    })

    request(app)
      .get('/')
      .expect(200, { entries: [true, true] }, done)
  })

  it('should not leak sub app semantics to the outer error path when headers were sent', function (done) {
    var app = express()
    var sub = express()
    var observed

    sub.set('trust proxy', '192.168.0.0')
    sub.use(function (req, res, next) {
      res.end('done')
      setImmediate(function () {
        next(new Error('late boom'))
      })
    })

    app.use(sub)
    app.use(function (err, req, res, next) {
      observed = {
        restored: Object.getPrototypeOf(req) === app.request,
        headersSent: res.headersSent
      }
    })

    request(app)
      .get('/')
      .expect(200, 'done')
      .end(function (err) {
        if (err) return done(err)
        setImmediate(function () {
          assert.deepStrictEqual(observed, { restored: true, headersSent: true })
          done()
        })
      })
  })

  it('should restore before a synchronous throw unwinds from app.handle()', function (done) {
    var app = express()
    var sub = express()
    var poisoned = true
    var restoredAtUnwind

    var router = new express.Router()
    router.use(function (req, res, next) {
      var setHeader = res.setHeader.bind(res)
      res.setHeader = function (name, value) {
        if (poisoned && name === 'X-Powered-By') {
          throw new Error('setup boom')
        }
        return setHeader(name, value)
      }
      next()
      restoredAtUnwind = Object.getPrototypeOf(req) === app.request
      poisoned = false
    })
    router.use(sub)
    app.use(router)

    app.use(function (err, req, res, next) {
      res.status(500).json({ error: err.message })
    })

    request(app)
      .get('/')
      .expect(500, { error: 'setup boom' })
      .end(function (err) {
        if (err) return done(err)
        assert.strictEqual(restoredAtUnwind, true)
        done()
      })
  })

  it('should preserve baseUrl, params and mount state while restoring', function (done) {
    var app = express()
    var sub = express()

    sub.get('/:id', function (req, res) {
      assert.strictEqual(req.baseUrl, '/api/v1')
      assert.strictEqual(req.params.id, '42')
      assert.strictEqual(req.app, sub)
      res.json({ id: req.params.id, baseUrl: req.baseUrl })
    })

    app.use('/api/:ver', function (req, res, next) {
      next()
    })
    app.use('/api/:ver', sub)
    app.use(function (req, res) {
      assert.strictEqual(Object.getPrototypeOf(req), app.request)
      assert.strictEqual(req.baseUrl, '')
      res.status(404).end()
    })

    request(app)
      .get('/api/v1/42')
      .expect(200, { id: '42', baseUrl: '/api/v1' }, done)
  })

  it('should emit "mount" and inherit parent settings only for app.use() mounts', function (done) {
    var app = express()
    var sub = express()
    var mountedParent

    app.set('trust proxy', '10.1.2.3')

    sub.on('mount', function (parent) {
      mountedParent = parent
    })

    app.use('/m', sub)

    assert.strictEqual(mountedParent, app)
    assert.strictEqual(sub.parent, app)
    assert.strictEqual(sub.mountpath, '/m')
    // sub app never configured trust proxy, so it inherits the parent value
    assert.strictEqual(sub.get('trust proxy'), '10.1.2.3')

    sub.get('/', function (req, res) {
      assert.strictEqual(req.app, sub)
      assert.strictEqual(req.app.get('trust proxy'), '10.1.2.3')
      res.json({ path: req.path })
    })

    request(app)
      .get('/m/')
      .expect(200, { path: '/' }, done)
  })

  it('should not leak semantics between concurrent requests', function (done) {
    var app = express()
    var sub = express()

    sub.set('trust proxy', '192.168.0.0')
    sub.use(function (req, res, next) {
      setTimeout(next, 20)
    })

    var router = new express.Router()
    router.use(sub)
    app.use(router, function (req, res) {
      res.json({
        restored: Object.getPrototypeOf(req) === app.request,
        app: req.app === app,
        id: req.query.id
      })
    })

    var pending = [1, 2, 3, 4].map(function (id) {
      return request(app)
        .get('/?id=' + id)
        .expect(200)
        .then(function (res) {
          assert.deepStrictEqual(res.body, { restored: true, app: true, id: String(id) })
        })
    })

    Promise.all(pending).then(function () {
      done()
    }, done)
  })
})
