'use strict'

var assert = require('node:assert')
var fs = require('node:fs')
var os = require('node:os')
var path = require('node:path')
var request = require('supertest')

var express = require('..')
var tmpl = require('./support/tmpl')

describe('res.render() view lookup security', function () {
  var dirs = []

  function makeLayout() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express-view-'))
    var root = path.join(dir, 'views')
    var outside = path.join(dir, 'outside')
    var sibling = path.join(path.dirname(root), 'views-evil')

    fs.mkdirSync(path.join(root, 'nested'), { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(sibling, { recursive: true })

    fs.writeFileSync(path.join(root, 'user.tmpl'), '<p>$user.name</p>')
    fs.writeFileSync(path.join(root, 'nested', 'page.tmpl'), '<h1>$title</h1>')
    fs.writeFileSync(path.join(root, 'nested', 'index.tmpl'), '<h1>nested index</h1>')
    fs.writeFileSync(path.join(outside, 'secret.tmpl'), 'SECRET OUTSIDE ROOT')
    fs.writeFileSync(path.join(sibling, 'trick.tmpl'), 'SECRET SIBLING ROOT')
    fs.writeFileSync(path.join(dir, 'secret.tmpl'), 'SECRET ABOVE ROOT')

    dirs.push(dir)
    return { dir: dir, root: root, outside: outside, sibling: sibling }
  }

  function createApp(views) {
    var app = express()
    app.engine('.tmpl', tmpl)
    app.set('view engine', 'tmpl')
    app.set('views', views)
    return app
  }

  after(function () {
    dirs.forEach(function (dir) {
      fs.rmSync(dir, { recursive: true, force: true })
    })
  })

  it('renders a legitimate nested template through the original engine', function (done) {
    var layout = makeLayout()
    var app = createApp(layout.root)

    app.use(function (req, res) {
      res.render('nested/page', { title: 'hi' })
    })

    request(app)
      .get('/')
      .expect(200, '<h1>hi</h1>', done)
  })

  it('renders an index template for a directory name', function (done) {
    var layout = makeLayout()
    var app = createApp(layout.root)

    app.use(function (req, res) {
      res.render('nested')
    })

    request(app)
      .get('/')
      .expect(200, '<h1>nested index</h1>', done)
  })

  describe('directory traversal', function () {
    it('rejects an encoded ".." traversal and never reads outside the root', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('nested/%2e%2e/%2e%2e/outside/secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET OUTSIDE ROOT/.test(res.text))
          assert.ok(res.text.indexOf(layout.dir) === -1,
            'response must not contain host paths')
        })
        .end(done)
    })

    it('rejects a raw ".." traversal above the root', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('../secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET ABOVE ROOT/.test(res.text))
          assert.ok(res.text.indexOf(layout.dir) === -1)
        })
        .end(done)
    })

    it('rejects double-encoded traversal after a single decode', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('nested/%252e%252e/secret')
      })

      request(app)
      .get('/')
      .expect(500)
      .expect(function (res) {
        assert.ok(/Failed to lookup view/.test(res.text))
        assert.ok(!/SECRET/.test(res.text))
      })
      .end(done)
    })
  })

  describe('absolute paths', function () {
    it('rejects an absolute path outside the root without leaking the file', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render(path.join(layout.outside, 'secret'))
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET OUTSIDE ROOT/.test(res.text))
          assert.ok(res.text.indexOf(layout.outside) === -1)
        })
        .end(done)
    })

    it('still renders an absolute path that is contained in the root', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render(path.join(layout.root, 'user'), { user: { name: 'tobi' } })
      })

      request(app)
      .get('/')
      .expect(200, '<p>tobi</p>', done)
    })
  })

  describe('windows-style names on any platform', function () {
    it('rejects a drive-letter path', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('C:\\Windows\\win')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(res.text.indexOf(layout.root) === -1)
        })
        .end(done)
    })

    it('rejects an encoded drive-letter path', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('%43%3a%5cWindows%5cwin')
      })

      request(app)
        .get('/')
        .expect(403)
        .end(done)
    })

    it('rejects a UNC path', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('\\\\server\\share\\secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .end(done)
    })

    it('treats backslashes as separators during traversal', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('nested\\..\\..\\outside\\secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET OUTSIDE ROOT/.test(res.text))
        })
        .end(done)
    })

    it('accepts a nested template written with backslashes', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('nested\\page', { title: 'back' })
      })

      request(app)
      .get('/')
      .expect(200, '<h1>back</h1>', done)
    })
  })

  describe('prefix-similar roots', function () {
    it('does not confuse "views" with the sibling "views-evil"', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('../views-evil/trick')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET SIBLING ROOT/.test(res.text))
          assert.ok(res.text.indexOf(layout.sibling) === -1)
        })
        .end(done)
    })
  })

  describe('multiple roots', function () {
    it('walks the roots in order and renders the first match', function (done) {
      var layout = makeLayout()
      var second = makeLayout()
      fs.writeFileSync(path.join(second.root, 'extra.tmpl'), '<p>from second root</p>')
      var app = createApp([layout.root, second.root])

      app.use(function (req, res) {
        res.render('extra')
      })

      request(app)
        .get('/')
        .expect(200, '<p>from second root</p>', done)
    })

    it('rejects a traversal when no root contains the resolved path', function (done) {
      var layout = makeLayout()
      var second = makeLayout()
      var app = createApp([layout.root, second.root])

      app.use(function (req, res) {
        res.render('../../outside/secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .expect(function (res) {
          assert.ok(!/SECRET OUTSIDE ROOT/.test(res.text))
          assert.ok(res.text.indexOf(layout.outside) === -1)
          assert.ok(res.text.indexOf(second.outside) === -1)
        })
        .end(done)
    })

    it('allows a traversal that normalizes inside another root', function (done) {
      var parent = fs.mkdtempSync(path.join(os.tmpdir(), 'express-multiroot-'))
      dirs.push(parent)
      var rootA = path.join(parent, 'a', 'views')
      var rootB = path.join(parent, 'b', 'views')
      fs.mkdirSync(path.join(rootA, 'nested'), { recursive: true })
      fs.mkdirSync(rootB, { recursive: true })
      fs.writeFileSync(path.join(rootB, 'shared.tmpl'), '<p>shared</p>')

      var app = createApp([rootA, rootB])

      app.use(function (req, res) {
        // the name resolves the same against both roots; against rootB it
        // points at a file inside that configured root
        app.set('views', [path.join(rootA, 'nested'), rootB])
        res.render(path.join('..', '..', 'b', 'views', 'shared'))
      })

      request(app)
      .get('/')
      .expect(200, '<p>shared</p>', done)
    })

    it('rejects a traversal that lands outside every root', function (done) {
      var parent = fs.mkdtempSync(path.join(os.tmpdir(), 'express-multiroot-'))
      dirs.push(parent)
      var rootA = path.join(parent, 'a', 'views')
      var rootB = path.join(parent, 'b', 'views')
      fs.mkdirSync(path.join(rootA, 'nested'), { recursive: true })
      fs.mkdirSync(rootB, { recursive: true })

      var app = createApp([path.join(rootA, 'nested'), rootB])

      app.use(function (req, res) {
        res.render(path.join('..', '..', '..', 'escape'))
      })

      request(app)
      .get('/')
      .expect(403, done)
    })
  })

  describe('missing templates keep their semantics', function () {
    it('returns the normal lookup error for a non-existent contained name', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('does/not/exist')
      })

      request(app)
        .get('/')
        .expect(500)
        .expect(function (res) {
          assert.ok(/Failed to lookup view/.test(res.text))
        })
        .end(done)
    })

    it('treats malformed percent-encoding as a missing view', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)

      app.use(function (req, res) {
        res.render('%e0%a4')
      })

      request(app)
        .get('/')
        .expect(500)
        .expect(function (res) {
          assert.ok(/Failed to lookup view/.test(res.text))
        })
        .end(done)
    })
  })

  describe('engine cache', function () {
    it('keeps rendering cached legitimate views and never caches escapes', function (done) {
      var layout = makeLayout()
      var app = createApp(layout.root)
      app.enable('view cache')
      var step = 0

      app.use(function (req, res, next) {
        if (step === 0) {
          step = 1
          return res.render('user', { user: { name: 'first' } })
        }
        next()
      })
      app.use(function (req, res) {
        res.render('../secret')
      })

      request(app)
        .get('/')
        .expect(200, '<p>first</p>')
        .end(function (err) {
          if (err) return done(err)
          request(app)
            .get('/')
            .expect(403)
            .expect(function (res) {
              assert.ok(!/SECRET ABOVE ROOT/.test(res.text))
            })
            .end(done)
        })
    })
  })

  describe('symlink boundary', function () {
    it('never stats or follows a path that escapes the root lexically', function (done) {
      var layout = makeLayout()
      var statSync = fs.statSync
      var touchedOutside = false

      fs.statSync = function (p) {
        if (String(p).indexOf(layout.outside) === 0) {
          touchedOutside = true
        }
        return statSync.apply(this, arguments)
      }

      var app = createApp(layout.root)
      app.use(function (req, res) {
        res.render('nested/%2e%2e/%2e%2e/outside/secret')
      })

      request(app)
        .get('/')
        .expect(403)
        .end(function (err) {
          fs.statSync = statSync
          if (err) return done(err)
          assert.strictEqual(touchedOutside, false,
            'no path outside the root should be stat()ed')
          done()
        })
    })

    it('keeps an in-root symlink inside the documented trust boundary', function (done) {
      var layout = makeLayout()

      // lexical containment runs before any read and cannot follow links; a
      // symlink already inside the root therefore remains part of the root's
      // trust boundary, the same boundary sendFile documents for static roots
      try {
        fs.symlinkSync(
          path.join(layout.outside, 'secret.tmpl'),
          path.join(layout.root, 'link.tmpl'))
      } catch (e) {
        this.skip()
        return
      }

      var app = createApp(layout.root)
      app.use(function (req, res) {
        res.render('link')
      })

      request(app)
        .get('/')
        .expect(200, 'SECRET OUTSIDE ROOT', done)
    })
  })
})
