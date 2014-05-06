/**
 * Peer.js
 *
 * @description :: Represents a peer, which is an individual node in the peer to peer network
 * @docs        :: http://sailsjs.org/#!documentation/models
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
      model: 'user'
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

    getChildrenConnections: function getChildren(connectionCriteria) {
      return _.filter(this.connections, _.extend({ endpoint: this.id }, connectionCriteria));
    },

    getParentConnections: function getParents(connectionCriteria) {
      return _.filter(this.connections, _.extend({ initiator: this.id }, connectionCriteria));
    },

    buildTree: function buildTree(connectionCriteria, transform) {
      // someone only passed in a transform
      // make all right with the world
      if (_.isFunction(connectionCriteria)) {
        transform = connectionCriteria;
        connectionCriteria = void 0;
      }

      connectionCriteria = connectionCriteria || { state: 'established' };

      // this is the root
      var root = this.toObject();
      var rootChannelId = _.isObject(root.channel) ? root.channel.id : root.channel;
      root._seen = true;
      root.children = [];

      var Q = [root];
      var V = Object.create(null);
      V[root.id] = true;

      // get all peers in this channel
      return sails.models.peer.find()
        .populate('connections')
        .then(function(peers) {
          // TODO filter out peers not in this channel
          // also convert to object, will maybe save lookup time when building tree

          // also TODO, use kruskal's with peer connections - will allow disconnected trees
          // also mess with _seen
          return _.map(peers, function(peer) {
            peer = peer.toObject();
            peer._seen = false;
            peer.children = [];
            return peer;
          });
        })
        .then(function(peers) {
          while (Q.length !== 0) {
            var parent = Q.shift();

            sails.log.silly('Peer#buildTree: got parent', parent);

            var children = _.filter(peers, function(peer) {
              sails.log.silly('Peer#buildTree checking peer', peer, 'for childship of parent');

              var peerChannelId = _.isObject(peer.channel) ? peer.channel.id : peer.channel;

              if (peer._seen || peer.id === root.id || peerChannelId !== rootChannelId) return false;

              if (_.some(peer.connections, _.extend({ endpoint: parent.id }, connectionCriteria))) {
                peer._seen = true;
                return true;
              }

              return false;
            });

            _.forEach(children, function(child) {
              sails.log.silly('Peer#buildTree: adding child to parent');
              Q.push(child);
              parent.children.push(child);
            });
          }
        })
        .then(function() {
          sails.log.verbose('Peer#buildTree: built tree', root);
          return root;
      });
    }

  },

  findConnectionsByPeerId: function findConnectionsByPeerId(peerId, connectionCriteria) {
    return sails.models.peer.findOne({ id: peerId })
      .populate('connections')
      .then(function(peer) {
        return _.filter(peer.connections, connectionCriteria);
      });
  },

  findChildrenConnectionsByPeerId: function findChildrenConnectionsByPeerId(peerId, extraCriteria) {
    return Peer.findConnectionsByPeerId(peerId, _.defaults({ endpoint: peerId }, extraCriteria));
  },

  findParentConnectionsByPeerId: function findParentConnectionsByPeerId(peerId, extraCriteria) {
    return Peer.findConnectionsByPeerId(peerId, _.defaults({ initiator: peerId }, extraCriteria));
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
        peerConns = _.pluck(peerConns, 'id');

        sails.log.silly('Peer#beforeDestroy: peerConns', peerConns);
        return peerConns;
      })
      .then(function(peerConns) {
        return PeerConnection.destroy({ id: peerConns });
      })
      .then(function(destroyedPeerConns) {
        // we have an array from both the map and then an array of destroyed peer connections within
        sails.log.silly('Peer#beforeDestroy: destroyedPeerConns', destroyedPeerConns);

        _.forEach(destroyedPeerConns, function(destroyedPeerConn) {
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
    sails.log.verbose('Peer#afterUpdate: values', values);
    cb();
  },

  afterDestroy: function afterPeerDestroy(values, cb) {
    sails.log.verbose('Peer#afterDestroy: values', values);
    cb();
  },

  afterPublishRemove: function afterPeerPublishRemove(id, alias, idRemoved, req) {
    sails.log.verbose('Peer#afterPublishRemove: id', id, 'alias', alias, 'idRemoved', idRemoved/*, 'req', req*/);
  },

  afterPublishDestroy: function afterPeerPublishDestroy(id, req, options) {
    sails.log.verbose('Peer#afterPublishDestroy: id', id, /*'attribute', attribute,*/ 'options', options /*, 'req', req*/);
  }

};

module.exports = Peer;
