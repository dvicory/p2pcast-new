/**
 * Peer.js
 *
 * @description :: Represents a peer, which is an individual node in the peer to peer network
 * @docs	:: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');
var Promise = require('bluebird');

var Peer = {
  adapter: 'memory',

  attributes: {
    socketId: {
      type: 'string',
      unique: true,
      required: true
    },

    user: {
      model: 'User'
    },

    channel: {
      model: 'channel',
      required: true
    },

    broadcaster: {
      type: 'boolean',
      required: true
    },

    connections: {
      collection: 'peerconnection',
      via: 'id',
      dominant: true
    },

    canRebroadcast: function canRebroadcast() {
      // broadcasters can always rebroadcast
      // TODO is this really true? should broadcaster have a parent peerconnection to itself?
      // this would mean that if their camera goes down their self peerconnection goes down too
      if (this.broadcaster) return true;

      // we only want established connections
      var upstreamConnections = _.filter(this.connections, { state: 'established' });

      // TODO make this function do double duty, say return connections that can be used
      return upstreamConnections.length > 0;
    },

    getChildrenConnections: function getChildren() {
      return _.filter(this.connections, { endpoint: this.id });
    },

    getParentConnections: function getParents() {
      return _.filter(this.connections, { initiator: this.id });
    }
  },

  findConnectionsByPeerId: function findConnectionsByPeerId(peerId, connectionCriteria) {
    return Peer.findById(peerId)
      .populate('connections')
      .then(function(peer) {
        return _.filter(peer.connections, connectionCriteria);
      });
  },

  findChildrenByPeerId: function findChildrenByPeerId(peerId) {
    return Peer.findConnectionsByPeerId(peerId, { endpoint: peerId });
  },

  findParentsByPeerId: function findChildrenByPeerId(peerId) {
    return Peer.findConnectionsByPeerId(peerId, { initiator: peerId });
  },

  beforeUpdate: function beforePeerUpdate(values, cb) {
    sails.log.info('Peer#beforeUpdate: values', values);
    cb();
  },

  beforeDestroy: function beforePeerDestroy(criteria, cb) {
    sails.log.info('Peer#beforeDestroy: criteria', criteria);

    // TODO using criteria directly may not be the best thing to do
    // get primaryKey from model?
    PeerConnection.find(
      { or: [
        { initiator: criteria.where.id },
        { endpoint: criteria.where.id }
      ] })
      .then(function(peerConns) {
	return peerConns;
      })
      .settle()
      .filter(function(inspection) {
	return inspection.isFulfilled();
      })
      .map(function(inspection) {
	return inspection.value();
      })
      .then(function(peerConns) {
	/*
	peerConns = _.map(peerConns, function(peerConn) {
	  return _.pick(peerConn, 'id');
	});
	 */
	// put all ids in an array
	peerConns = _.pluck(peerConns, 'id');

        sails.log.info('Peer#beforeDestroy: peerConns', peerConns);
	return peerConns;
      })
      .then(function(peerConns) {
	return PeerConnection.destroy({ id: peerConns });
      })
      .then(function(destroyedPeerConns) {
	// we have an array from both the map and then an array of destroyed peer connections within
	//destroyedPeerConns = _.flatten(destroyedPeerConns, true);
        sails.log.info('Peer#beforeDestroy: destroyedPeerConns', destroyedPeerConns);

        _.forEach(destroyedPeerConns, function(destroyedPeerConn) {
          //sails.log.info('Peer#beforeDestroy: destroyedPeerConn', destroyedPeerConn);
	  PeerConnection.publishDestroy(destroyedPeerConn.id, null, { previous: destroyedPeerConn });
	});
      })
      .error(function(err) {
	return cb(err);
      })
      .catch(function(e) {
	return cb(e);
      })
      .finally(function() {
        return cb();
      });
  },

  afterUpdate: function afterPeerUpdate(values, cb) {
    sails.log.info('Peer#afterUpdate: values', values);
    cb();
    return;

    PeerConnection.find(
      { or: [
	{ initiator: values.id },
	{ endpoint: values.id }
      ] })
      .then(function(peerConns) {
	sails.log.info('Peer#afterUpdate: peerConns', peerConns);
      })
      .finally(function() {
	cb();
      });
  },

  afterDestroy: function afterPeerDestroy(values, cb) {
    sails.log.info('Peer#afterDestroy: values', values);
    cb();
    return;

    PeerConnection.find(
      { or: [
        { initiator: values.id },
        { endpoint: values.id }
      ] })
      .then(function(peerConns) {
        sails.log.info('Peer#afterDestroy: peerConns', peerConns);
      })
      .finally(function() {
        cb();
      });
  },

  afterPublishRemove: function afterPeerPublishRemove(id, alias, idRemoved, req) {
    sails.log.info('Peer#afterPublishRemove: id', id, 'alias', alias, 'idRemoved', idRemoved/*, 'req', req*/);
  },

  afterPublishDestroy: function afterPeerPublishDestroy(id, req, options) {
    sails.log.info('Peer#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options /*, 'req', req*/);
    return;

    var outboundDestroyer = Promise.method(function(removedPeer) {
      if (!removedPeer.outbound || removedPeer.outbound.length === 0) {
        sails.log.info('Peer#afterPublishDestroy: No outbound to destroy for peer', removedPeer.id);
      } else {
        console.log('removedPeer.outbound', removedPeer.outbound);

	_.each(removedPeer.outbound, function(outboundConn) {
	  sails.log.info('Peer#afterPublishDestroy: Destroyed outbound connection', outboundConn.id, 'with', outboundConn.endpoint, 'as the endpoint');

	  PeerConnection.destroy({ id: outboundConn.id })
	    .then(function() {
	      PeerConnection.publishDestroy(outboundConn.id);
	    });
	});
      }

      return removedPeer.outbound.length;
    });

    outboundDestroyer(options.previous)
      .then(function(num1) {
        sails.log.info('Peer#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options, /*'req', req,*/ 'num1', num1);
      });

    return;

    var outboundDestroyer = Promise.method(function(removedPeer) {
      // it's okay if there is none
      if (!removedPeer.outbound || removedPeer.outbound.length === 0) {
        sails.log.info('Peer#afterPublishDestroy: No outbound to destroy for peer', removedPeer.id);
      } else {
	console.log('removedPeer.outbound', removedPeer.outbound);
        _.each(removedPeer.outbound, function(outbound) {
          sails.log.info('Peer#afterPublishDestroy: Destroyed outbound connection', outbound.id, 'with', outbound.endpoint, 'as the endpoint');
          removedPeer.outbound.remove(outbound.id);
          PeerConnection.destroy({ id: outbound.id })
            .then(function() {
              PeerConnection.publishDestroy(outbound.id);
            });

          PeerConnection.find({ endpoint: removedPeer.id })
            .then(function(peerConns) {
              _.each(peerConns, function(peerConn) {
                sails.log.info('Peer#afterPublishDestroy: Destroyed outbound connection', peerConn.id, 'with', peerConn.endpoint, 'as the endpoint');
                removedPeer.outbound.remove(peerConn.id);
                PeerConnection.destroy({ id: peerConn.id })
                  .then(function() {
                    PeerConnection.publishDestroy(peerConn.id);
                  });
              });
            });
        });

        return removedPeer.outbound.length;
      }
    });

    outboundDestroyer(options.previous)
      .then(function(num1) {
        sails.log.info('Peer#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options, /*'req', req,*/ 'num1', num1);
      });
  }

};

module.exports = Peer;
