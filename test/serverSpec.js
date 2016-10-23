var expect = require('expect');
var faker = require('faker');
var merge = require('mout/object/merge');
var url = require('url');


describe('server', function() {


  var server;
  beforeEach(function() {
    server = createServer();
  });


  it('should create server', function() {
    expect(server).toExist();
  });


  describe('client registration', function() {
    it('should create client', function() {
      var redirectUris = [faker.internet.url()];
      var client = server.createClient({
        'redirect_uris': redirectUris
      });


      expect(client.client_id).toExist();
      expect(client.client_secret).toExist();
      expect(client.redirect_uris).toEqual(redirectUris);
    });


    it('should throw error if we do not pass redirect uris', function() {
      expect(function() {
        server.createClient();
      }).toThrow();


      expect(function() {
        server.createClient({'redirect_uris': []});
      }).toThrow();
    });


    it('should register client', function() {
      var client = server.registerClient({
        'redirect_uris': [faker.internet.url()]
      });


      expect(server.getClient(client.client_id)).toEqual(client);
    });
  });


  describe('client authorization', function() {
    it('should render error page if client is not registered', function() {
      var clientId = faker.random.uuid();
      var req = createRequestMock({'client_id': clientId});
      var res = createResponseMock();


      server.authorize(req, res);


      expect(res.render).toHaveBeenCalledWith('error', {
        error: 'Unknown client'
      });
    });


    it('should render error page if redirect uri do not match', function() {
      var client = server.registerClient({'redirect_uris': ['http://foo.com']});
      var clientId = client.client_id;
      var req = createRequestMock({
        'client_id': clientId,
        'redirect_uri': ['http://bar.com']
      });
      var res = createResponseMock();


      server.authorize(req, res);


      expect(res.render).toHaveBeenCalledWith('error', {
        error: 'Invalid redirect URI'
      });
    });


    it('should render page to ask the user for authorization', function() {
      var client = server.registerClient({'redirect_uris': ['http://foo.com']});
      var clientId = client.client_id;
      var req = createRequestMock({'client_id': clientId, 'redirect_uri': client.redirect_uris[0]});
      var res = createResponseMock();


      server.authorize(req, res);


      var args = res.render.calls[0].arguments;
      expect(args[0]).toEqual('approve');
      expect(args[1].client).toEqual(client);
      expect(args[1].reqid).toExist();
    });
  });


  describe('client approve', function() {
    it('should render error page if request does not contain request id', function(){
      var res = createResponseMock();
      var req = createRequestMock(null, {body: {
        reqid: '1',
        approve: true
      }});


      server.approve(req, res);


      expect(res.render).toHaveBeenCalledWith('error', {
        error: 'No matching authorization request'
      });
    });


    it('should return error if user denied access', function(){
      var authorization = createClientAuthorization(server);
      var redirectUri = authorization.redirectUri;
      var reqid = authorization.reqid;


      var req = createRequestMock(null, {body: {
        reqid: reqid,
        approve: false
      }});
      var res = createResponseMock();


      server.approve(req, res);


      expect(res.redirect.calls[0].arguments[0])
        .toEqual(redirectUri + '/?error=access_denied');
    });


    it('should return error if server does not support passed authorization type', function() {
      var authorizationType = 'foo';
      var authorization = createClientAuthorization(server, authorizationType);
      var redirectUri = authorization.redirectUri;
      var reqid = authorization.reqid;


      var req = createRequestMock(null, {body: {
        reqid: reqid,
        approve: true
      }});
      var res = createResponseMock();


      server.approve(req, res);


      expect(res.redirect.calls[0].arguments[0])
        .toEqual(redirectUri + '/?error=unsupported_response_type');
    });


    it('should return authorization code', function() {
      var authorizationType = 'code';
      var state = 'foo';
      var authorization = createClientAuthorization(server, authorizationType, {
        state: state
      });
      var redirectUri = authorization.redirectUri;
      var reqid = authorization.reqid;


      var req = createRequestMock(null, {body: {
        reqid: reqid,
        approve: true
      }});
      var res = createResponseMock();


      server.approve(req, res);


      var redirectUri = url.parse(res.redirect.calls[0].arguments[0], true);


      expect(redirectUri.query.code).toExist();
      expect(redirectUri.query.state).toEqual(state);
    });
  });


  function createRequestMock(query, params) {
    return merge({
      query: query
    }, params);
  }

  function createResponseMock() {
    return {
      render: expect.createSpy(),
      redirect: expect.createSpy()
    };
  }


  function createClientAuthorization(server, authorizationType, params) {
    params = params || {};

    var redirectUri = faker.internet.url();
    var client = server.registerClient({'redirect_uris': [redirectUri]});
    var clientId = client.client_id;
    var req = createRequestMock({
      'client_id': clientId,
      'response_type': authorizationType,
      'redirect_uri': client.redirect_uris[0],
      'state': params.state
    });
    var res = createResponseMock();

    server.authorize(req, res);

    return {
      client: client,
      reqid: res.render.calls[0].arguments[1].reqid,
      redirectUri: redirectUri
    };
  }
});


function createServer() {
  var clients = [];
  var requests = {};


  return {
    authorize: function(req, res) {
      var client = getClient(clients, req.query.client_id);


      if (!client) {
        return res.render('error', {
          error: 'Unknown client'
        });
      }


      var contains = require('mout/array/contains');
      if (!contains(client.redirect_uris, req.query.redirect_uri)) {
        return res.render('error', {
          error: 'Invalid redirect URI'
        });
      }


      var reqid = require('mout/random/guid')();
      requests[reqid] = req.query;
      res.render('approve', {
        client: client,
        reqid: reqid
      });
    },


    approve: function(req, res) {
      var reqid = req.body.reqid;
      var approve = req.body.approve;
      var query = requests[reqid];

      delete requests[reqid];


      if (!query) {
        return res.render('error', {
          error: 'No matching authorization request'
        });
      }


      if (!approve) {
        return redirectWithError('access_denied');
      }


      if (query.response_type !== 'code') {
        return redirectWithError('unsupported_response_type');
      }


      var code = require('mout/random/guid')();

      return res.redirect(buildUrl(
        query.redirect_uri,
        {
          code: code,
          state: query.state
        }
      ));

      function redirectWithError(error) {
        var url = require('url');
        var redirectUri = url.format(merge(url.parse(query.redirect_uri), {
          query: {
            error: error
          }
        }));

        return res.redirect(redirectUri);
      }

      function buildUrl(uri, query) {
        var url = require('url');
        return url.format(merge(url.parse(uri), {
          query: query
        }));
      }
    },


    registerClient: function(params) {
      var client = createClient(params);
      clients.push(client);
      return client;
    },


    createClient: createClient,


    getClient: function(clientId) {
      return getClient(clients, clientId);
    }
  };
}


function createClient(params) {
  var guid = require('mout/random/guid');
  params = params || {};

  if (!params.redirect_uris || !params.redirect_uris.length) {
    throw Error('(createClient) should specify redirect_uris');
  }

  return {
    'client_id': guid(),
    'client_secret': guid(),
    'redirect_uris': params.redirect_uris
  };
}


function getClient(clients, clientId) {
  var find = require('mout/array/find');

  return find(clients, function(client) {
    return client.client_id === clientId;
  });
}
