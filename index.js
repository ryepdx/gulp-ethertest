 var _ = require('lodash');
var through = require('through2');
var web3 = require('web3');
var colors = require('colors');
var gutil = require('gulp-util');
var PluginError = gutil.PluginError;

var RPCTester = function (opts, contracts) {
  this.opts = [];
  this.contracts = contracts;
  this.skippedContracts = [];
  this.logWatchers = [];

  this.testTxs = {
    pending: [],
    failed: [],
    passed: [],
    deployed: [],
    obj: {} 
  };

  this.contractTxs = {
    pending: [],
    completed: [],
    failed: [],
    obj: {}
  };

  this.opts = _.extend({
    web3: null,
    primaryAddress: null,
    gas: null,
    gasPrice: null,
    endowment: 0,
    value: 0,
    rpcURL: 'http://localhost:8545',
    outstream: process.stdout,
    watchLogEvents: true,
    colors: true
  }, opts || {});

  if (this.opts.web3 === null && !this.opts.rpcURL) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'You must supply either a web3 object or an rpcURL value!'
    });
  }

  if (this.opts.web3 === null) {
    this.opts.web3 = web3;
    this.opts.web3.setProvider(new web3.providers.HttpProvider(this.opts.rpcURL));
  }

  if (!this.opts.web3.currentProvider) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'You must set an RPC provider for web3!'
    });
  }
  this.opts.gasPrice = this.opts.gasPrice || this.opts.web3.eth.gasPrice;

  if (this.opts.web3.eth.accounts.length === 0) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'Need at least one account!'
    });
  }
  this.opts.primaryAddress = this.opts.primaryAddress || this.opts.web3.eth.defaultAccount || this.opts.web3.eth.accounts[0];
};


RPCTester.prototype.completedContractTxsChange = function () {
  if (this.contractTxs.pending.length === 0) return;

  var completedTxs = [];

  for (var i=0; i < this.contractTxs.pending.length; i+=1) {
    var txHash = this.contractTxs.pending[i];
    var receipt = this.opts.web3.eth.getTransactionReceipt(txHash);
    if (!receipt || !receipt.blockHash) continue;
    if (!receipt.contractAddress) {
      that.emit('error', new PluginError({
        plugin: 'Ethertest',
        message: 'Failed to deploy ' + name + ' contract!'
      }));
      this.contractTxs.failed.push(txHash);

    } else {
      completedTxs.push(txHash);
      this.contractTxs.completed.push(txHash);
      this.contractTxs.obj[txHash].address = receipt.contractAddress;
    }
  }

  this.contractTxs.pending = _.difference(this.contractTxs.pending, this.contractTxs.failed);
  this.contractTxs.pending = _.difference(this.contractTxs.pending, this.contractTxs.completed);

  return completedTxs;
};


RPCTester.prototype.checkTestTxs = function () {
  if (this.testTxs.pending.length === 0) return;

  for (var i=0; i < this.testTxs.pending.length; i+=1) {
    var txHash = this.testTxs.pending[i];
    var receipt = web3.eth.getTransactionReceipt(txHash);
    if (!receipt || !receipt.blockHash) continue;

    var txBlock = this.opts.web3.eth.getBlock(receipt.blockNumber);
    if (txBlock.gasLimit <= receipt.cumulativeGasUsed) {
      var output = "";

      // Prepend any logging output.
      if (this.testTxs.obj[txHash].logs.length > 0) {
        output += _.pluck(_.sortBy(this.testTxs.obj[txHash].logs, "index"), "data").join("\n");
      }
      output += "FAIL (out of gas) - " + this.testTxs.obj[txHash].name + " (tx " + txHash + ") \n";

      if (this.opts.colors) {
        output = output.red;
      }
      this.testTxs.obj[txHash].contract.outputBuffer += output;
      this.testTxs.failed.push(txHash);
    } else {
      this.testTxs.deployed.push(txHash);
    }
  }

  this.testTxs.pending = _.difference(this.testTxs.pending, this.testTxs.failed);
  this.testTxs.pending = _.difference(this.testTxs.pending, this.testTxs.deployed);
};


RPCTester.prototype.isFinished = function () {
  if (this.contracts.length > (this.skippedContracts.length + this.contractTxs.completed.length) ||
      this.testTxs.pending.length > 0 ||
      this.testTxs.deployed.length > this.testTxs.passed.length + this.testTxs.failed.length) {
    return false;
  }
  return true;
};


RPCTester.prototype.write = function (data) {
  this.opts.outstream.write(data);
};


RPCTester.prototype.writeReport = function () {
  var passString;
  var numTests = (this.testTxs.passed.length + this.testTxs.failed.length);

  if (this.testTxs.failed.length === 0) {
      passString = "Passed " + this.testTxs.passed.length + " out of " + numTests + " tests\n";

  } else {
      passString = "Failed " + this.testTxs.failed.length + " out of " + numTests + " tests\n";
  }
  if (this.opts.colors) {
      passString = (this.testTxs.failed.length === 0) ? passString.green : passString.red;
  }

  this.write("\n" + passString);
};


RPCTester.prototype.stopWatchers = function () {
  this.blockWatcher.stopWatching();
  this.assertWatch.stopWatching();
  _.forEach(this.logWatchers, function (watcher) {
      watcher.stopWatching();
  });
};


RPCTester.prototype.watchLogs = function () {
  var that = this;
  if (!that.opts.watchLogEvents) return;

  var logTopics = _.map([
      'Log(string)', 'LogBytes(bytes32)',
      'LogStr(string)', 'LogUint(uint256)',
      'LogInt(int256)', 'LogBool(bool)'
  ], function (signature) { return "0x" + web3.sha3(signature); });

  var logger = function (err, res) {
    var line;
    if (err) {
      err = "ERROR: " + err + "\n";
      if (that.opts.colors) {
          err = err.red;
      }
      that.write(err);
    } else {
      line = "LOG: " + res.args[0];
      if (that.opts.colors) {
          line = line.yellow;
      }
      that.testTxs.obj[res.transactionHash].logs.push({index: res.logIndex, data: line});
    }
  };

  _.forEach(logTopics, function (topic) {
    that.logWatchers.push(web3.eth.filter({fromBlock: 'latest', topics: [topic]}).watch(logger));
  });
};


RPCTester.prototype.watchAsserts = function () {
  var that = this;
  that.assertWatch = web3.eth
      .filter({fromBlock: 'latest', topics: ["0x"+web3.sha3("Assert(bool)")]})
      .watch(function (err, res) {

    if (err) {
      err = "ERROR: " + err + "\n";
      if (opts.colors) {
        err = err.red;
      }
      that.write(err);
      return;
    }

    if (_.includes(that.testTxs.failed, res.transactionHash) || _.includes(that.testTxs.passed, res.transactionHash)) {
      return;
    }

    var testPassed = Boolean(that.opts.web3.toDecimal(res.data));
    if (testPassed) {
      that.testTxs.passed.push(res.transactionHash);

    } else {
      that.testTxs.failed.push(res.transactionHash);
    }

    var logOutput = "";
    var txObj = that.testTxs.obj[res.transactionHash];
    if (txObj.logs.length > 0) {
      logOutput += _.pluck(_.sortBy(txObj.logs, "index"), "data").join("\n") + "\n";
    }

    var output;
    if (testPassed) {
      output = "PASS - " + txObj.name + "\n";
    } else {
      output = "FAIL - " + txObj.name + " (tx " + res.transactionHash + ") \n";
    }

    if (that.opts.colors) {
      output = testPassed ? output.green : output.red;
    }
    txObj.contract.outputBuffer += (logOutput + output);

    that.testTxs.pending = _.difference(that.testTxs.pending, that.testTxs.passed);
    that.testTxs.pending = _.difference(that.testTxs.pending, that.testTxs.failed);

    if (_.intersection(txObj.contract.testTxs, that.testTxs.pending).length === 0) {
      that.write(txObj.contract.outputBuffer);
      txObj.contract.outputBuffer = "";

      if (_.some(txObj.contract.abi, function (e) { return e.name === 'kill'; })) {
        that.opts.web3.eth.contract(txObj.contract.abi).at(txObj.contract.address).kill();
      }
    }
  });
};


RPCTester.prototype.watchBlocks = function () {
  var that = this;
  that.blockWatcher = that.opts.web3.eth.filter('latest', function () {
    that.checkTestTxs();
    
    if (that.isFinished()) {
      that.stopWatchers();
      that.writeReport();
      return;
    }

    var completedContracts = _.map(that.completedContractTxsChange(), function (txHash) {
      return that.contractTxs.obj[txHash];
    });

    if (completedContracts.length > 0) {
      that.createTestTxs(completedContracts);
    }
  });
};


RPCTester.prototype.createContractTxs = function () {
  var that = this;

  _.forEach(that.contracts, function (contract) {
    contract.outputBuffer = "\n" + (that.opts.colors ? contract.name.bold : contract.name) + "\n";
    contract.tests = _.map(_.filter(contract.abi, function (elem) {
      return /^[t|T]est|^[s|S]hould/.test(elem.name);
    }), function (elem) { return elem.name; });

    if (contract.tests.length === 0) {
      that.write("\n" + contract.name + "\n");
      that.write('No test functions found, skipping!\n');
      that.skippedContracts.push(contract.name);
      return;
    }

    var tx = {
      from: that.opts.primaryAddress, data: contract.bin,
      gas: that.opts.gas, gasPrice: that.opts.gasPrice,
      value: that.opts.endowment
    };

    var txHash = that.opts.web3.eth.sendTransaction(tx);
    that.contractTxs.pending.push(txHash);
    that.contractTxs.obj[txHash] = contract;
  });
};


RPCTester.prototype.createTestTxs = function (contracts) {
  var that = this;
  
  _.forEach(contracts, function (contract) {
    contract.testTxs = [];
    contractRPC = that.opts.web3.eth.contract(contract.abi).at(contract.address);

    _.forEach(contract.tests, function (testName) {
      var testString = testName.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
      var txHash = contractRPC[testName]({
        from: that.opts.primaryAddress, gas: that.opts.gas,
        gasPrice: that.opts.gasPrice, value: that.opts.value
      });
      that.testTxs.pending.push(txHash);
      that.testTxs.obj[txHash] = {
        name: testString, logs: [], output: [], contract: contract
      };
      contract.testTxs.push(txHash);
    });
  });
};


RPCTester.prototype.runTests = function () {
  this.watchLogs();
  this.watchAsserts();
  this.watchBlocks();
  this.createContractTxs();
};


module.exports = function (opts) {
  var tester;
  var contracts = {};
  var contractRegex = /\.bin$|\.abi$/;
  var bufferContracts = function (file, enc, callback) {
      if (!contractRegex.test(file.path)) {
        return callback();
      }

      var type = file.path.match(contractRegex)[0].slice(1);
      var name = file.path.replace(contractRegex, '');

      if (type != 'bin' && type != 'abi') {
        return callback();
      }

      if (!/Test$/.test(name)) {
        return callback();
      }

      var data = file.contents.toString();

      if (type === 'abi') {
        data = JSON.parse(data);

        var assertEvent = _.find(data, {name: 'Assert', type: 'event'});
        if (!assertEvent || assertEvent.inputs.length !== 1 || assertEvent.inputs[0].type !== 'bool') {
            return callback();
        }
      }

      if (!(name in contracts)) {
        contracts[name] = {name: name};
      }
      contracts[name][type] = data;

      tester = new RPCTester(opts, _.values(contracts));
      tester.write("ethertest: Loaded " + file.path + "\n");
      callback();
  };

  var endStream = function (callback) {
    if (contracts === {}) {
      callback();
      return;
    }
    tester.runTests();
  };

  return through.obj(bufferContracts, endStream);
};
