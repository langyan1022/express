'use strict'

var assert = require('node:assert')
var express = require('..')
var fs = require('node:fs')
var os = require('node:os')
var path = require('node:path')
var request = require('supertest')
var tmpl = require('./support/tmpl')

var SECRET = 'TOP-SECRET-CONTENT'

describe('res', function () {
  describe('.render(name) view lookup confinement', function () {
    var tmp
    var root1
    var root2
    var outside

    function createApp() {
      var app = express()

      app.engine('.tmpl', tmpl)
      app.set('view engine', 'tmpl')
      app.set('views', [root1, root2])

      app.use(function (req, res) {
        res.render(req.query.view, { page: 'page' })
      })

      return app
    }

    before(function () {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'express-views-'))
      root1 = path.join(tmp, 'views1')
      root2 = path.join(tmp, 'views2')
      outside = path.join(tmp, 'outside')

      fs.mkdirSync(path.join(root1, 'pages'), { recursive: true })
      fs.mkdirSync(root2, { recursive: true })
      fs.mkdirSync(outside, { recursive: true })

      fs.writeFileSync(path.join(root1, 'pages', 'index.tmpl'), 'nested $page')
      fs.writeFileSync(path.join(root1, 'shared.tmpl'), 'from first root')
      fs.writeFileSync(path.join(root2, 'shared.tmpl'), 'from second root')
      fs.writeFileSync(path.join(root2, 'only-second.tmpl'), 'second root')
      fs.writeFileSync(path.join(outside, 'secret.tmpl'), SECRET)
    })

    after(function () {
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    it('should render a nested template within the views root', function (done) {
      request(createApp())
        .get('/?view=pages/index')
        .expect(200, 'nested page', done)
    })

    it('should render an absolute path within the views root', function (done) {
      request(createApp())
        .get('/?view=' + encodeURIComponent(path.join(root1, 'pages', 'index.tmpl')))
        .expect(200, 'nested page', done)
    })

    it('should lookup views in multiple roots in order', function (done) {
      request(createApp())
        .get('/?view=shared.tmpl')
        .expect(200, 'from first root', done)
    })

    it('should lookup views in later roots until found', function (done) {
      request(createApp())
        .get('/?view=only-second.tmpl')
        .expect(200, 'second root', done)
    })

    it('should reject encoded ".." traversal outside the views root', function (done) {
      request(createApp())
        .get('/?view=%2e%2e%2foutside%2fsecret.tmpl')
        .expect(500)
        .expect(function (res) {
          assert.ok(!res.text.includes(SECRET), 'response must not contain the secret file content')
          assert.ok(!res.text.includes(root1), 'response must not contain the views root path')
          assert.ok(!res.text.includes(root2), 'response must not contain the views root path')
          assert.ok(!res.text.includes(outside), 'response must not contain the outside directory path')
        })
        .end(done)
    })

    it('should reject ".." traversal outside every views root', function (done) {
      request(createApp())
        .get('/?view=' + encodeURIComponent('../outside/secret.tmpl'))
        .expect(500)
        .expect(function (res) {
          assert.ok(!res.text.includes(SECRET), 'response must not contain the secret file content')
          assert.ok(!res.text.includes(root1), 'response must not contain the views root path')
          assert.ok(!res.text.includes(outside), 'response must not contain the outside directory path')
        })
        .end(done)
    })

    it('should reject absolute paths outside the views root', function (done) {
      // the requested name is reflected in the error message, so only
      // host-side paths the client did not supply are checked here
      request(createApp())
        .get('/?view=' + encodeURIComponent(path.join(outside, 'secret.tmpl')))
        .expect(500)
        .expect(function (res) {
          assert.ok(!res.text.includes(SECRET), 'response must not contain the secret file content')
          assert.ok(!res.text.includes(root1), 'response must not contain the views root path')
          assert.ok(!res.text.includes(root2), 'response must not contain the views root path')
        })
        .end(done)
    })

    it('should reject Windows-style separators, drive letters and UNC names', function (done) {
      var names = [
        '..\\outside\\secret.tmpl',
        '../outside\\secret.tmpl',
        'C:\\outside\\secret.tmpl',
        '\\\\server\\share\\secret.tmpl'
      ]

      var app = createApp()

      ;(function next(i) {
        if (i === names.length) return done()

        request(app)
          .get('/?view=' + encodeURIComponent(names[i]))
          .expect(500)
          .expect(function (res) {
            assert.ok(!res.text.includes(SECRET), 'response must not contain the secret file content')
            assert.ok(!res.text.includes(root1), 'response must not contain the views root path')
            assert.ok(!res.text.includes(root2), 'response must not contain the views root path')
          })
          .end(function (err) {
            if (err) return done(err)
            next(i + 1)
          })
      })(0)
    })

    it('should not confuse look-alike prefixes with the views root', function (done) {
      // "views1-evil" shares a prefix with the "views1" root but is
      // not inside it; a prefix string compare would get this wrong
      fs.mkdirSync(root1 + '-evil', { recursive: true })
      fs.writeFileSync(root1 + '-evil' + path.sep + 'secret.tmpl', SECRET)

      request(createApp())
        .get('/?view=' + encodeURIComponent('../views1-evil/secret.tmpl'))
        .expect(500)
        .expect(function (res) {
          assert.ok(!res.text.includes(SECRET), 'response must not contain the secret file content')
        })
        .end(done)
    })

    it('should follow symlinks inside the views root (lexical boundary)', function (done) {
      // the confinement check is lexical, matching res.sendFile():
      // a symlink inside the views root is a platform-level link the
      // application explicitly placed there, so it is still followed
      try {
        fs.symlinkSync(path.join(outside, 'secret.tmpl'), path.join(root1, 'linked.tmpl'))
      } catch (err) {
        // symlinks may require privileges on some platforms
        return this.skip()
      }

      request(createApp())
        .get('/?view=linked.tmpl')
        .expect(200, SECRET, done)
    })
  })
})
