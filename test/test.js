var glob = require('glob')
var t = require('../lib/root.js')
var spawn = require('child_process').spawn
var node = process.execPath
var fs = require('fs')
var dir = __dirname + '/test/'
var path = require('path')
var yaml = require('js-yaml')

function regEsc (str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
}

module.exports = function (pattern) {
  glob.sync(dir + pattern).forEach(runTests)
}

if (module === require.main) {
  if (process.argv[2]) {
    module.exports(process.argv[2])
  } else {
    t.pass('just a common file')
  }
}

function runTests (file) {
  var skip = false
  if (file.match(/\b(timeout.*|pending-handles)\.js$/)) {
    if (process.env.TRAVIS) {
      skip = 'timeout and handles tests too timing dependent for Travis'
    } else if (process.platform === 'win32') {
      skip = 'timeout and handles tests rely on sinals windows cannot do'
    }
  }

  if (file.match(/\bsigterm\b/)) {
    if (process.version.match(/^v0\.10\./)) {
      skip = 'sigterm handling test does not work on 0.10'
    } else if (process.platform === 'win32') {
      skip = 'sigterm handling is weird on windows'
    }
  }

  var f = file.substr(dir.length)
  t.test(f, { skip: skip }, function (t) {
    t.test('bail=false', function (t) {
      runTest(t, false, file)
    })
    t.test('bail=true', function (t) {
      runTest(t, true, file)
    })
    t.end()
  })
}

function runTest (t, bail, file) {
  var resfile = file.replace(/\.js$/, (bail ? '-bail' : '') + '.tap')
  var want = fs.readFileSync(resfile, 'utf8').split(/\r?\n/)

  var child = spawn(node, [file], {
    stdio: [ 0, 'pipe', 'pipe' ],
    env: {
      TAP_BAIL: bail ? 1 : 0
    }
  })

  var found = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', function (c) {
    found += c
  })
  child.on('close', function (er) {
    found = found.split(/\r?\n/)
    var inyaml = false
    var startlen = 0
    var y = ''

    // walk line by line so yamlish (json) can be handled
    // otherwise making any changes in this lib would hurt
    for (var f = 0, w = 0;
         f < found.length && w < want.length;
         f++, w++) {
      var wline = want[w]
      var fline = found[f]
      var wdata = false

      if (inyaml) {
        if (fline.match(/^\s*\.\.\.$/) && fline.length === startlen) {
          var data = yaml.safeLoad(y)
          inyaml = false
          y = ''
          wdata = JSON.parse(wline)
          patternify(wdata)
          t.match(data, wdata)
          f--
        } else {
          y += fline + '\n'
          w--
        }
        continue
      } else {
        t.match(fline, patternify(wline),
                'line ' + f + ' ' +
                wline.replace(/# (todo|skip)/gi, '- $1'),
                { test: f })

        if (fline.match(/^\s*\-\-\-$/)) {
          startlen = fline.length
          inyaml = true
          y = ''
        }
      }

      if (!t.passing()) {
        return t.end()
      }
    }
    t.end()
  })
}

function patternify (pattern) {
  if (typeof pattern === 'object' && pattern) {
    Object.keys(pattern).forEach(function (k) {
      pattern[k] = patternify(pattern[k])
    })
    return pattern
  }

  if (typeof pattern !== 'string') {
    return pattern
  }

  var re = /___\/(.*?)\/~~~/
  var match = pattern.match(re)
  if (!match) {
    return pattern
  }

  var pl = pattern.split('___/')
  var p = '^' + regEsc(pl.shift())

  pl.forEach(function (wlpart) {
    var wlp = wlpart.split('/~~~')
    p += wlp.shift()
    p += regEsc(wlp.join('/~~~'))
  })
  p += '$'
  return new RegExp(p)
}
