var util = require('util')
  , http = require('http')
  , events = require('events')
  , sio = require('socket.io')
  , SocketMessages = require('socket-messages')
  , Exchange = require('bus.io-exchange')
  , Message = require('./message')
  , Builder = require('./builder')
  , Receiver = require('./receiver')
  ;

module.exports = Server;

Server.Exchange = Exchange;


/**
 * The bus
 *
 * @param {object} io socket.io intance or http.Server
 */

function Server (a) {

  if (!(this instanceof Server)) return new Server(a);

  var self = this;

  events.EventEmitter.call(this);

  /**
   * Called when we are supposed to publish the message. this is bound to a 
   * Builder instance an Receiver instances
   *
   * @param {Message} message
   */

  this.onPublish = function (message) {
    if (message.data.published) {
      self.exchange().publish(message.data, message.data.target);
    }
    else {
      message.data.published = new Date();
      self.exchange().publish(message.data);
    }
  };


  /**
   * Called when we receive a socket connection, this is bound to the
   * socket.io instance
   *
   * @param {Socket} socket
   */

  this.onConnection = function (socket) {

    function handle (message) {
      self.emit('from exchange pubsub', message, socket);
    }

    self.messages().actor(socket, function (err, actor) {
      if (err) return self.emit('error', err);
      self.exchange().channel(actor).on('message', handle); 
      socket.on('disconnect', function () {
        self.exchange().channel(actor).removeListener('message', handle);
      });
    });

  };

  /**
   * Called when we reeived a message from the SocketMessages.  This is bound
   * to the SocketMessages instance.  It will then emit an event for the
   * SocketReceiver intance to handle. This is when the SocketMessages instance
   * finishes createing the message and before the message is passed along to
   * the Receiver for processing before dispatched to the Exchange.
   *
   * @param {object} message
   * @param {Socket} socket
   * @see SocketMessages
   * @see Receiver
   */

  this.onMessage = function (message, socket) {
    self.emit('from socket', message, socket);
  };

  /**
   * Called after we have received a message from the Exchange
   *
   * @param {Message} message
   * @param {Socket} socket
   * @see Exchange
   * @see Receiver
   */

  this.onReceivedPubSub = function (message, socket) {
    socket.emit.apply(socket, [message.data.action, message.data.actor].concat(message.data.content).concat([message.data.target, message.data.created]));
  };

  /**
   * Called after we have received a message from the socket.  This is after
   * the SocketMessage instance creates a message and the Receiver instance
   * processes it through the middleware.
   *
   * @param {Message} message
   * @param {Socket} socket
   * @see SocketMessages
   * @see Receiver
   */

  this.onReceivedSocket = function (message, socket) {
    self.message(message).deliver();
  };

  /**
   * Called when we receveie a message on the Queue
   *
   * @param {object} message
   * @see Exchange
   */

  this.onReceivedQueue = function (message) {
    self.emit('from exchange queue', message.data);
  };

  /**
   * Handles our error
   *
   * @param {mixed} err
   */

  this.onError = function () {
    console.error.apply(console,Array.prototype.slice.call(arguments));
  };

  this.addListener('error', this.onError);

  this.incomming();

  this.processing();

  this.outgoing();

  this.autoPropagate(true);

  if (a) {
    this.listen(a);
  }
}

util.inherits(Server, events.EventEmitter);

/**
 * Listen on the port or socket.io instance
 *
 * @param {mixed} Either a number or a Socket.IO instance
 * @return Server
 */

Server.prototype.listen = function (a) {

  if (a instanceof sio) {
    this.io(a);
  }
  else if (!isNaN(a)) {
    this.io().listen(a);
  }
  else {
    this.io(sio(a));
  }

  return this;
};

/**
 * Gets a builder for the passed data
 *
 * @param {object} data
 * @return Builder
 */

Server.prototype.message = function (data) {
  var builder = Builder(data);
  builder.on('built', this.onPublish);
  return builder;
};


/**
 * Sets / Gets the Exchange
 *
 * @param {Exchange} exchange
 * @return Exchange / Server
 */

Server.prototype.exchange = function (exchange) {

  if (typeof exchange === 'object' && exchange instanceof Exchange) {
    
    if (this._exchange) {
      this._exchange.queue().removeListener('message', this.onReceivedQueue);
    }

    this._exchange = exchange;
    this._exchange.queue().addListener('message', this.onReceivedQueue);
    return this;
  }

  if (!this._exchange || (!(typeof this._exchange === 'object' && this._exchange instanceof Exchange))) {
    this.exchange(Exchange());
  }

  return this._exchange;

};

/**
 * Sets / Gets SocketMessages instance
 *
 * @param {SocketMessages} io * optioanl
 * @return SocketMessages / Server
 */

Server.prototype.messages = function (messages) {
  
  if (typeof messages === 'object' && messages instanceof SocketMessages) {

    if (this._messages) {
      this._messages.dettach(this.io());
      this._messages.exchange().removeListener('message', this.onMessage);
    }

    this._messages = messages;
    this._messages.exchange().on('message', this.onMessage);
    return this;

  }

  if (!this._messages || (!(typeof this._messages === 'object' && this._messages instanceof SocketMessages) )) {
    this.messages(SocketMessages.make());
  }

  return this._messages;

};

/**
 * Sets / Gets SocketMessages instance
 *
 * @deprecated Use messages() instead
 * @param {SocketMessages} io * optioanl
 * @return SocketMessages / Server
 */

Server.prototype.socketMessages = Server.prototype.messages;

/**
 * Sets / Gets Socket.IO instance
 *
 * @param {SocketIO} io * optioanl
 * @return SocketIO / Server
 */

Server.prototype.io = function (io) {

  if (typeof io === 'object') {
    
    if (this._io) {
      this.messages().dettach(this._io);
      this._io.removeListener('connection', this.onConnection);
    }

    this._io = io;
    this.messages().attach(this._io);
    this._io.on('connection', this.onConnection);
    return this;

  }

  if (!this._io) {
    this.io(sio());
  }
  
  return this._io;

};

/**
 * Sets up a handler for the exchange
 *
 * @see Recevier
 * @param {mixex} First item bust be a string or function
 * @return Server
 */

Server.prototype.on = function () {
  if (arguments.length >= 1 && typeof arguments[0] === 'string') {
    this.messages().action(arguments[0]);
  }
  this.processing().use.apply(this.processing(), Array.prototype.slice.call(arguments));
  return this;
};

/**
 * delegate
 *
 * @see SocketMessages
 */

Server.prototype.actor = function () {
  var o = this.messages();
  o.actor.apply(o, Array.prototype.slice.call(arguments));
  return this;
};

/**
 * delegate
 *
 * @see SocketMessages
 */

Server.prototype.target = function () {
  var o = this.messages();
  o.target.apply(o, Array.prototype.slice.call(arguments));
  return this;
};

/**
 * initialize the receiver.  it will handle messages comming from the socket
 * before it gets to the exchange
 *
 * @see Receiver
 * @return Server / Receiver
 */

Server.prototype.incomming = function (o) {

  if (typeof o === 'object' && o instanceof Receiver) {
    if (this._incomming) {
      this.removeListener('from socket', this._incomming.onReceive);
      this._incomming.removeListener('error', this.onError);
      this._incomming.removeListener('received', this.onReceivedSocket);
    }

    this._incomming = o;
    this._incomming.addListener('error', this.onError);
    this._incomming.addListener('received', this.onReceivedSocket);
    this.addListener('from socket', this._incomming.onReceive);

    return this;
  }

  if (!this._incomming || (!(this._incomming instanceof Receiver))) {
    this.incomming(Receiver());
  }

  return this._incomming;

};

Server.prototype.socketReceiver = Server.prototype.incomming;

/**
 * initializes the receiver.  it will handle messages on the bus, this happens
 * after we get the message in from the socket, and before we send the message
 * to the socket.
 *
 * @see Receiver
 * @return Server / Receiver
 */

Server.prototype.processing = function (o) {

  if (typeof o === 'object' && o instanceof Receiver) {
    if (this._processing) {
      this.removeListener('from exchange queue', this._processing.onReceive);
      this._processing.removeListener('error', this.onError);
      this._processing.removeListener('received', this.onPublish);
    }

    this._processing = o;
    this._processing.addListener('error', this.onError);
    this._processing.addListener('received', this.onPublish);
    this.addListener('from exchange queue', this._processing.onReceive);

    return this;
  }

  if (!this._processing || (!(this._incomming instanceof Receiver))) {
    this.processing(Receiver());
  }

  return this._processing;

};

/**
 * initialize the receiver.  it will handle messages comming from the exchange
 * before it gets to the socket
 *
 * @see Receiver
 * @param {Receiver} o
 * @return Server / Receiver
 */

Server.prototype.outgoing = function (o) {

  if (typeof o === 'object' && o instanceof Receiver) {
    if (this._outgoing) {
      this.removeListener('from exchange pubsub', this._outgoing.onReceive);
      this._outgoing.removeListener('error', this.onError);
      this._outgoing.removeListener('received', this.onReceivedPubSub);
    }

    this._outgoing = o;
    this._outgoing.addListener('error', this.onError);
    this._outgoing.addListener('received', this.onReceivedPubSub);
    this.addListener('from exchange pubsub', this._outgoing.onReceive);

    return this;
  }

  if (!this._outgoing || (!(this._outgoing instanceof Receiver))) {
    this.outgoing(Receiver());
  }

  return this._outgoing;

};

Server.prototype.exchangeReceiver = Server.prototype.outgoing;


/**
 * Binds a method to the exchange receiver for processing the incomming 
 * messages from the exchange before being dispatched to the socket.
 *
 * @see Receiver
 * @param {mixed} First item must be a string or Function
 * @return Server
 */

Server.prototype.out = function () {
  this.outgoing().use.apply(this.outgoing(), Array.prototype.slice.call(arguments));
  return this;
};

/**
 * Binds a method to the socket receiver for processing the incomming
 * message received from the SocketMessages before being dispatched to the 
 * exchange.
 *
 * @see Receiver
 * @param {mixed} First item must be a string or Function
 * @return Server
 */

Server.prototype.in = function () {
  this.incomming().use.apply(this.incomming(), Array.prototype.slice.call(arguments));
  return this;
};

/**
 * Binds the method to socket.io's "connection" event
 *
 * @see socket.io
 * @param {function} fn
 * @return Server
 */

Server.prototype.socket = function (fn) {
  var self = this;
  this.io().on('connection', function (socket) {
    return fn(socket, self);
  });
  return this;
};

/**
 * sets up an alias for the actor / socket
 *
 * @param {Socket} socket
 * @param {string} name
 * @return Server
 */

Server.prototype.alias = function (socket, name) {

  var self = this;
  var handle = function (message) {
    self.emit('from exchange pubsub', message, socket);
  };

  this.exchange().channel(name).on('message', handle);

  socket.on('disconnect', function () {
    self.exchange().channel(name).removeListener('message', handle);
  });

  return this;
};

/**
 * delegates the call to queue
 *
 * @return Queue / Server
 */

Server.prototype.queue = function (queue) {
  if (typeof queue !== 'undefined') {
    this.exchange().queue().removeListener('message', this.onReceivedQueue);
    queue.addListener('message', this.onReceivedQueue);
    this.exchange().queue(queue);
    return this;
  }
  return this.exchange().queue();
};

/**
 * delegates the call to pubsub
 *
 * @return PubSub / Server
 */

Server.prototype.pubsub = function (pubsub) {
  if (typeof pubsub !== 'undefined') {
    this.exchange().pubsub(pubsub);
    return this;
  }
  return this.exchange().pubsub();
};

/**
 * delegates the call to messages()
 *
 * @return Boolean / Server
 */

Server.prototype.autoPropagate = function (v) {
  if (typeof v === 'boolean') {
    this.messages().autoPropagate(v);
    return this;
  }
  return this.messages().autoPropagate();
};
