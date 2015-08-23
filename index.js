var _ = require('lodash');
var through = require('through2');
var web3 = require('web3');
var colors = require('colors');
var gutil = require('gulp-util');
var PluginError = gutil.PluginError;

module.exports = function (opts) {
  opts = _.extend({
    web3: null,
    primaryAddress: null,
    gas: null,
    gasPrice: null,
    endowment: 0,
    value: 0,
    rpcURL: 'http://localhost:8545',
    outstream: process.stdout,
    colors: true
  }, opts || {});

  if (opts.web3 === null && !opts.rpcURL) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'You must supply either a web3 object or an rpcURL value!'
    });
  }

  if (opts.web3 === null) {
    opts.web3 = web3;
    opts.web3.setProvider(new web3.providers.HttpProvider(opts.rpcURL));
  }

  if (!opts.web3.currentProvider) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'You must set an RPC provider for web3!'
    });
  }
  opts.gasPrice = opts.gasPrice || opts.web3.eth.gasPrice;

  if (opts.web3.eth.accounts.length === 0) {
    new PluginError({
        plugin: 'Ethertest',
        message: 'Need at least one account!'
    });
  }
  opts.primaryAddress = opts.primaryAddress || opts.web3.eth.defaultAccount || opts.web3.eth.accounts[0];

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

      opts.outstream.write("ethertest: Loaded " + file.path + "\n");

      if (!(name in contracts)) {
        contracts[name] = {};
      }
      contracts[name][type] = data;
      callback();
  };

  var endStream = function (callback) {
    if (contracts === {}) {
      callback();
      return;
    }

    var that = this;
    var testTxs = {};
    var suitesProcessed = 0;
    var suitesRun = 0;
    var suitesPassed = 0;
    _.forOwn(contracts, function (contract, name) {
      var testNames = _.map(_.filter(contracts[name].abi, function (elem) {
        return /^[t|T]est|^[s|S]hould/.test(elem.name);
      }), function (elem) { return elem.name; });

      if (testNames.length === 0) {
        suitesProcessed += 1;
        opts.outstream.write("\n" + name + "\n");
        opts.outstream.write('No test functions found, skipping!\n');
        return;
      }

      var tx = {
          from: opts.primaryAddress, data: contracts[name].bin,
          gas: opts.gas, gasPrice: opts.gasPrice, value: opts.endowment
      };

      var TestContract = opts.web3.eth.contract(contracts[name].abi);
      var txHash = opts.web3.eth.sendTransaction(tx);
      var testsFinished = 0;
      var outputBuffer = "\n" + (opts.colors ? name.bold : name) + "\n";

      var blockWatch = opts.web3.eth.filter('latest', function () {
        var receipt = opts.web3.eth.getTransactionReceipt(txHash);
        if (!receipt || !receipt.blockHash) return;
        if (!receipt.contractAddress) {
          blockWatch.stopWatching();
          that.emit('error', new PluginError({
            plugin: 'Ethertest',
            message: 'Failed to deploy ' + name + ' contract!'
          }));
        }

        var outOfGasTxs = [];
        for (testTxHash in testTxs) {
            var txReceipt = web3.eth.getTransactionReceipt(testTxHash);
            if (!txReceipt) continue;

            var txBlock = web3.eth.getBlock(txReceipt.blockHash);
            if (txBlock.gasLimit <= txReceipt.cumulativeGasUsed) {
                var output = "";
                if (testTxs[testTxHash].logs.length > 0) {
                    output += _.pluck(_.sortBy(testTxs[testTxHash].logs, "index"), "data").join("\n");
                }
                output += "FAIL (out of gas) - " + testTxs[testTxHash].name + " (tx " + testTxHash + ") \n";

                if (opts.colors) {
                    output = output.red;
                }
                outputBuffer += output;
                testsFinished += 1;
                outOfGasTxs.push(testTxHash);
            }
        }
        testTxs = _.omit(testTxs, outOfGasTxs);

        var contract = TestContract.at(receipt.contractAddress);
        var logger = function (err, res) {
            var line;
            if (err) {
                err = "ERROR: " + err;
                if (opts.colors) {
                    err = err.red;
                }
                opts.outstream.write(err);
            } else {
                line = "LOG: " + res.args.message;
                if (opts.colors) {
                    line = line.yellow;
                }
                testTxs[res.transactionHash].logs.push({index: res.logIndex, data: line});
            }
        };

        var logWatchers = [];
        _.each(['Log', 'LogBytes', 'LogStr', 'LogUint'], function (logEvent) {
            if (!contract[logEvent]) return;
            logWatchers.push(contract[logEvent]().watch(logger));
        });

        var passes = 0;
        seenTxs = [];
        var assertWatch = contract.Assert().watch(function (err, res) {
            if (err) {
                err = "ERROR: " + err;
                if (opts.colors) {
                    err = err.red;
                }
                opts.outstream.write(err);
                return;
            }
            if (_.includes(seenTxs, res.transactionHash)) { return; }
            seenTxs.push(res.transactionHash);

            var testPassed = _.values(res.args)[0];

            if (testPassed) {
                passes += 1;
            }
            testsFinished += 1;

            var logOutput = "";
            if (testTxs[res.transactionHash].logs.length > 0) {
                logOutput += _.pluck(_.sortBy(testTxs[res.transactionHash].logs, "index"), "data").join("\n") + "\n";
            }

            var output;
            if (testPassed) {
                output = "PASS - " + testTxs[res.transactionHash].name + "\n";
            } else {
                output = "FAIL - " + testTxs[res.transactionHash].name + " (tx " + testTxHash + ") \n"
            }

            if (opts.colors) {
                output = testPassed ? output.green : output.red;
            }
            outputBuffer += (logOutput + output);

            if (testsFinished === _.keys(testNames).length) {
                assertWatch.stopWatching();
                suitesProcessed += 1;
                suitesRun += 1;
                
                var passString;
                if (passes === testsFinished) {
                    suitesPassed += 1;
                    passString = "Passed " + passes + " out of " + testsFinished + " test cases\n";
                } else {
                    passString = "Failed " + (testsFinished - passes) + " out of " + testsFinished + " test cases\n";
                }
                if (opts.colors) {
                    passString = (passes === testsFinished) ? passString.green : passString.red;
                }
                outputBuffer += passString;

                if (suitesProcessed === _.keys(contracts).length) {
                  var suitePassString;
                  if (suitesPassed === suitesRun) {
                    suitePassString= "\n" + suitesPassed + " out of " + suitesRun + " test contracts passed!\n";
                  } else {
                    suitePassString= "\n" + (suitesRun - suitesPassed) + " out of " + suitesRun + " test contracts failed!\n";
                  }

                  if (opts.colors) {
                    suitePassString = (suitesPassed === suitesRun) ? suitePassString.bold.green : suitePassString.bold.red;
                  }
                  if (suitesProcessed > suitesRun) {
                    suitePassString += "(Skipped " + (suitesProcessed - suitesRun) + " tests due to lack of test cases.)\n";
                  }
                  outputBuffer += suitePassString;
                }
                opts.outstream.write("\n" + outputBuffer)
                outputBuffer = "";
                assertWatch.stopWatching();
                _.forEach(logWatchers, function (watcher) {
                    watcher.stopWatching();
                });
                callback();
            }
            blockWatch.stopWatching();
        });

        _.forEach(testNames, function (testName) {
          var result;
          var testString = testName.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
          var testTxHash = contract[testName]({
            from: opts.primaryAddress, gas: opts.gas, gasPrice: opts.gasPrice, value: opts.value
          });
          testTxs[testTxHash] = {name: testString, logs: []};
        });
      });
    });
  };

  return through.obj(bufferContracts, endStream);
};
