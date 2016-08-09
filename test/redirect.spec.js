/* global describe, it, afterEach */

var assert = require('chai').assert;
var captureHar = require('./captureHar');
var nock = require('nock');
var lolex = require('lolex');
var utils = require('./utils');

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
      .reply(301, null);
    return captureHar({
      url: 'http://www.google.com'
    })
      .then(har => {
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 301);
        // should this add an _error property or is just one entry enough information?
        assert.lengthOf(har.log.entries, 1);
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

  it('can disable redirect recording', function () {
    this.scope = nock('http://www.google.com')
      .get('/')
      .reply(() => {
        return [ 301, null, { location: '/maps' } ];
      })
      .get('/maps')
      .reply(() => {
        return [ 200, 'body' ];
      });
    return captureHar({
      url: 'http://www.google.com'
    }, { withRedirects: false })
      .then(har => {
        assert.lengthOf(har.log.entries, 1);
        assert.deepPropertyVal(har, 'log.entries[0].request.url', 'http://www.google.com/');
        assert.deepPropertyVal(har, 'log.entries[0].response.status', 200);
      });
  });
});
