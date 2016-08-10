/* global describe, it, afterEach */

var assert = require('chai').assert;
var captureHar = require('./captureHar');
var nock = require('nock');
var lolex = require('lolex');
// var utils = require('./utils');

describe('redirects', function () {
  afterEach(function () {
    if (this.clock) {
      this.clock.uninstall();
    }
    nock.cleanAll();
  });

  it('handles invalid redirects', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(301, null); // missing location header
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
        assert.lengthOf(har.log.entries, 1);
        assert.deepPropertyVal(har, 'log.entries[0].response._error.message', 'Missing location header');
        assert.deepPropertyVal(har, 'log.entries[0].response._error.code', 'NOLOCATION');
      });
  });

  it('records redirects', function () {
    this.clock = lolex.install(1262304000000);
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(() => {
        this.clock.tick(1000);
        return [ 301, null, { location: '/maps' } ];
      })
      .get('/maps')
      .reply(() => {
        this.clock.tick(2000);
        return [ 200, 'body' ];
      });
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].startedDateTime', '2010-01-01T00:00:00.000Z');
        assert.deepPropertyVal(har, 'log.entries[0].time', 1000);

        assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
        assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://www.google.com/maps');

        assert.deepPropertyVal(har, 'log.entries[1].startedDateTime', '2010-01-01T00:00:01.000Z');
        assert.deepPropertyVal(har, 'log.entries[1].time', 2000);

        assert.notDeepProperty(har, 'log.entries[1].response._error');
        assert.notDeepProperty(har, 'log.entries[1].response._error');
      });
  });

  it('can disable automatic redirect', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(301, null, { location: '/maps' });
    return captureHar({
      url: 'http://www.google.com',
      followRedirect: false
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
        assert.deepPropertyVal(har, 'log.entries[0].response.redirectURL', 'http://www.google.com/maps');
        assert.lengthOf(har.log.entries, 1);
      });
  });

  it('can do maxRedirects', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .times(10)
      .reply(301, null, { location: '/' });
    return captureHar({
      url: 'http://www.google.com',
      maxRedirects: 5
    })
      .then(har => {
        assert.lengthOf(har.log.entries, 5);
        assert.deepPropertyVal(har, 'log.entries[4].response._error.message', 'Max redirects exceeded');
        assert.deepPropertyVal(har, 'log.entries[4].response._error.code', 'MAXREDIRECTS');
      });
  });

  it('can do followRedirect by function', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(301, null, { location: '/1', redirect: '1' })
      .get('/1')
      .reply(301, null, { location: '/2' })
      .get('/1')
      .reply(200);
    return captureHar({
      url: 'http://www.google.com',
      followRedirect: (res) => {
        return !!res.headers.redirect;
      }
    })
      .then(har => {
        assert.lengthOf(har.log.entries, 2);
      });
  });

  it('handles location header on other statuscodes', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(200, 'hello', { location: '/path' })
      .get('/path')
      .reply(200);
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.lengthOf(har.log.entries, 1);
      });
  });
});
