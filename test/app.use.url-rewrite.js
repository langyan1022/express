'use strict'

var assert = require('node:assert')
var express = require('..')
var http = require('node:http')
var request = require('supertest')

describe('app', function(){
  describe('.use() url rewrite state', function(){
    function rewriteApp(mount, rewrite) {
      var app = express()
      var sub = express.Router()

      sub.use(function (req, res, next) {
        req.url = rewrite(req.url)
        next()
      })

      app.use(mount, sub)
      app.use(function (req, res) {
        res.json({
          url: req.url,
          baseUrl: req.baseUrl,
          originalUrl: req.originalUrl
        })
      })

      return app
    }

    function rewriteRootToIndex(url) {
      return url === '/' || url.indexOf('/?') === 0
        ? '/index.html' + (url.indexOf('?') === -1 ? '' : url.slice(url.indexOf('?')))
        : url
    }

    it('should re-anchor a rewritten root url under "/app"', function(done){
      var app = rewriteApp('/app', rewriteRootToIndex)

      request(app)
      .get('/app')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app' }, done)
    })

    it('should re-anchor a rewritten root url under "/app" with trailing slash request', function(done){
      var app = rewriteApp('/app', rewriteRootToIndex)

      request(app)
      .get('/app/')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app/' }, done)
    })

    it('should re-anchor a rewritten root url when mounted under "/app/"', function(done){
      var app = rewriteApp('/app/', rewriteRootToIndex)

      request(app)
      .get('/app/')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app/' }, done)
    })

    it('should not produce a double slash when mounted under "/app/"', function(done){
      var app = rewriteApp('/app/', rewriteRootToIndex)

      request(app)
      .get('/app')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app' }, done)
    })

    it('should preserve the query string of a rewritten url', function(done){
      var app = rewriteApp('/app', rewriteRootToIndex)

      request(app)
      .get('/app?a=1&b=2')
      .expect(200, { url: '/app/index.html?a=1&b=2', baseUrl: '', originalUrl: '/app?a=1&b=2' }, done)
    })

    it('should re-anchor rewrites through two levels of mounting', function(done){
      var app = express()
      var mid = express.Router()
      var inner = express.Router()

      inner.use(function (req, res, next) {
        if (req.url === '/') req.url = '/index.html'
        next()
      })

      mid.use('/sub', inner)
      app.use('/app', mid)
      app.use(function (req, res) {
        res.json({
          url: req.url,
          baseUrl: req.baseUrl,
          originalUrl: req.originalUrl
        })
      })

      request(app)
      .get('/app/sub')
      .expect(200, { url: '/app/sub/index.html', baseUrl: '', originalUrl: '/app/sub' }, done)
    })

    it('should expose mount-relative url and baseUrl inside the router', function(done){
      var app = express()
      var sub = express.Router()
      var seen

      sub.use(function (req, res, next) {
        req.url = '/index.html'
        seen = { url: req.url, baseUrl: req.baseUrl, originalUrl: req.originalUrl }
        next()
      })

      app.use('/app', sub)
      app.use(function (req, res) { res.end('ok') })

      request(app)
      .get('/app')
      .expect(200)
      .expect(function(){
        assert.deepStrictEqual(seen, { url: '/index.html', baseUrl: '/app', originalUrl: '/app' })
      })
      .end(done)
    })

    it('should restore the rewritten url on next("router")', function(done){
      var app = express()
      var sub = express.Router()

      sub.use(function (req, res, next) {
        if (req.url === '/') req.url = '/index.html'
        next('router')
      })

      app.use('/app', sub)
      app.use(function (req, res) {
        res.json({
          url: req.url,
          baseUrl: req.baseUrl,
          originalUrl: req.originalUrl
        })
      })

      request(app)
      .get('/app')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app' }, done)
    })

    it('should restore the rewritten url on the error path', function(done){
      var app = express()
      var sub = express.Router()

      sub.use(function (req, res, next) {
        if (req.url === '/') req.url = '/index.html'
        next(new Error('boom'))
      })

      app.use('/app', sub)
      app.use(function (err, req, res, next) {
        res.json({
          error: err.message,
          url: req.url,
          baseUrl: req.baseUrl,
          originalUrl: req.originalUrl
        })
      })

      request(app)
      .get('/app')
      .expect(200, { error: 'boom', url: '/app/index.html', baseUrl: '', originalUrl: '/app' }, done)
    })

    it('should leave non-rewritten requests untouched', function(done){
      var app = rewriteApp('/app', function (url) { return url })

      request(app)
      .get('/app')
      .expect(200, { url: '/app', baseUrl: '', originalUrl: '/app' }, done)
    })

    it('should preserve "//" sequences of non-rewritten requests', function(done){
      var app = rewriteApp('/app', function (url) { return url })

      request(app)
      .get('/app//deep//x')
      .expect(200, { url: '/app//deep//x', baseUrl: '', originalUrl: '/app//deep//x' }, done)
    })

    it('should preserve encoded characters of non-rewritten requests', function(done){
      var app = rewriteApp('/app', function (url) { return url })

      request(app)
      .get('/app/%20x')
      .expect(200, { url: '/app/%20x', baseUrl: '', originalUrl: '/app/%20x' }, done)
    })

    it('should not share rewrite state between requests', function(done){
      var app = rewriteApp('/app', rewriteRootToIndex)

      request(app)
      .get('/app')
      .expect(200, { url: '/app/index.html', baseUrl: '', originalUrl: '/app' }, function (err) {
        if (err) return done(err)
        request(app)
        .get('/app/x')
        .expect(200, { url: '/app/x', baseUrl: '', originalUrl: '/app/x' }, done)
      })
    })

    it('should re-anchor rewrites of absolute-form requests', function(done){
      var app = express()
      var sub = express.Router()

      sub.use(function (req, res, next) {
        if (req.url === 'http://example.com') req.url = '/index.html'
        next()
      })

      app.use('/app', sub)
      app.use(function (req, res) {
        res.json({
          url: req.url,
          baseUrl: req.baseUrl,
          originalUrl: req.originalUrl
        })
      })

      var server = app.listen(0, function () {
        var port = server.address().port
        var req = http.request({
          port: port,
          path: 'http://example.com/app'
        }, function (res) {
          var body = ''
          res.on('data', function (chunk) { body += chunk })
          res.on('end', function () {
            server.close(function () {
              assert.deepStrictEqual(JSON.parse(body), {
                url: 'http://example.com/app/index.html',
                baseUrl: '',
                originalUrl: 'http://example.com/app'
              })
              done()
            })
          })
        })
        req.on('error', done)
        req.end()
      })
    })
  })
})
