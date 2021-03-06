angular.module('cesium.wallets.controllers', ['cesium.services', 'cesium.currency.controllers'])

  .config(function($stateProvider) {
    'ngInject';
    $stateProvider

      .state('app.view_wallets', {
        url: "/wallets",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/list/view_wallets.html",
            controller: 'WalletListCtrl'
          }
        },
        data: {
          login: true
        }
      })

      .state('app.view_wallet_by_id', {
        url: "/wallets/:id?refresh",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet.html",
            controller: 'WalletCtrl'
          }
        },
        data: {
          login: true,
          silentLocationChange: true
        }
      })

      .state('app.view_wallet_tx_by_id', {
        url: "/history/wallets/:id?refresh",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet_tx.html",
            controller: 'WalletTxCtrl'
          }
        },
        data: {
          login: true,
          silentLocationChange: true
        }
      })

      .state('app.view_wallet_tx_errors_by_id', {
        url: "/history/wallets/:id/errors",
        views: {
          'menuContent': {
            templateUrl: "templates/wallet/view_wallet_tx_error.html",
            controller: 'WalletTxErrorCtrl'
          }
        },
        data: {
          login: true
        }
      })
    ;
  })


  .controller('WalletListCtrl', WalletListController)

  .controller('WalletSelectModalCtrl', WalletSelectModalController)

  .controller('WalletListImportModalCtrl', WalletListImportModalController)

  .controller('PopoverWalletSelectModalCtrl', PopoverWalletSelectModalController)
;

function WalletListController($scope, $controller, $state, $timeout, $q, $translate, $ionicPopover, $ionicPopup,
                              ModalUtils,
                              UIUtils, Modals, csCurrency, csSettings, csWallet){
  'ngInject';

  $scope.settings = csSettings.data;
  $scope.listeners = [];

  // Initialize the super class and extend it.
  angular.extend(this, $controller('WalletSelectModalCtrl', {$scope: $scope, parameters: {}}));

  // Override defaults
  $scope.formData.name = undefined;
  $scope.motion = UIUtils.motion.default;
  $scope.entered = false;

  $scope.enter = function(e, state) {
    // First enter
    if (!$scope.entered) {
      $scope.entered = true;
      $scope.setParameters({
        showDefault: true,
        showBalance: true,
        minData: true
      });

      return $scope.load()
        .then(function() {
          UIUtils.loading.hide();
          if (!$scope.wallets) return; // user cancel, or error
          $scope.addListeners();
          $scope.showFab('fab-add-wallet');
        });
    }
    // If already enter
    else {
      // Re-add listeners
      $scope.addListeners();
      if ($scope.formData.stopped) {
        $scope.loading = false;
        $scope.formData.stopped = false;
        $scope.formData.updatingWalletId = undefined;
        $scope.updateView();
      }
    }
  };
  $scope.$on('$ionicView.enter', $scope.enter);

  $scope.leave = function() {
    $scope.formData.stopped = true;
    $scope.formData.updatingWalletId = undefined;
    $scope.loading = false;
    $scope.removeListeners();
  };
  $scope.$on('$ionicView.leave', $scope.leave);

  $scope.cancel = function() {
    $scope.showHome();
  };

  $scope.select = function(event, wallet) {
    if (event.isDefaultPrevented()) return;
    if (wallet.isDefault()) {
      $state.go('app.view_wallet');
    }
    else {
      $state.go('app.view_wallet_by_id', {id: wallet.id});
    }
  };

  $scope.editWallet = function(event, wallet) {

    event.preventDefault();

    return $scope.showEditPopup(wallet)
      .then(function(newName) {
        if (!newName) return;

        // Save changes
        return csWallet.auth({minData: true})
          .then(function() {
            wallet.data.localName = newName;
            csWallet.storeData();
            UIUtils.loading.hide();
            $scope.updateView();
          })
          .catch(function(err) {
            if (err === 'CANCELLED') {
              return UIUtils.loading.hide();
            }
            UIUtils.onError('ERROR.SAVE_WALLET_LIST_FAILED')(err);
          });
      });
  };

  $scope.downloadAsFile = function() {
    if (!$scope.wallets) return; // user cancel
    return csWallet.children.downloadFile();
  };

  $scope.addNewWallet = function(wallet) {

    if (!wallet) return $q.reject("Missing 'wallet' argument");

    // Make sure auth on the main wallet
    if (!csWallet.isAuth()) {
      return csWallet.auth({minData: true})
        .then(function() {
          return $scope.addNewWallet(wallet); // loop
        })
        .catch(function(err) {
          if (err === 'CANCELLED') {
            return UIUtils.loading.hide();
          }
          UIUtils.onError('ERROR.ADD_SECONDARY_WALLET_FAILED')(err);
        });
    }

    // Call API extension on child wallet
    return csWallet.api.data.raisePromise.load(wallet.data)
      // continue, when plugins extension failed (just log in console)
      .catch(console.error)
      .then(function() {
        $scope.addListenersOnWallet(wallet);
        csWallet.children.add(wallet);
      });
  };

  /* -- modals -- */

  $scope.showNewWalletModal = function() {

    var wallet = csWallet.children.instance();
    return wallet.login({
      showNewAccountLink: false,
      title: 'ACCOUNT.WALLET_LIST.BTN_NEW',
      okText: 'COMMON.BTN_ADD',
      // Load data options :
      minData: true,
      sources: true,
      api: false,
      success: UIUtils.loading.show,
      method: 'PUBKEY' // Default method - fix #767
    })
      .then(function(walletData) {
        if (!walletData) { // User cancelled
          UIUtils.loading.hide(100);
          return;
        }

        // Avoid to add main wallet again
        if (csWallet.isUserPubkey(walletData.pubkey)) {
          UIUtils.loading.hide();
          UIUtils.alert.error('ERROR.COULD_NOT_ADD_MAIN_WALLET');
          return;
        }

        // Avoid to add exists wallet again
        if (csWallet.children.hasPubkey(walletData.pubkey)) {
          UIUtils.loading.hide();
          UIUtils.alert.error('ERROR.COULD_NOT_ADD_EXISTING_WALLET');
          return;
        }

        console.debug("[wallet] Adding secondary wallet {"+walletData.pubkey.substring(0,8)+"}");

        // Add the child wallet
        return $scope.addNewWallet(wallet)
          .then(function() {
            UIUtils.loading.hide();
            $scope.updateView();
          });
      })
      .catch(function(err) {
        if (err === 'CANCELLED') {
          // Silent
          UIUtils.loading.hide();
        }
      });
  };

  $scope.selectAndRemoveWallet = function() {
    $scope.hideActionsPopover();
    return Modals.showSelectWallet({
        wallets: $scope.wallets,
        showDefault: false
      })
      .then(function(wallet) {
        if (!wallet || !wallet.id) return;

        // Make sure to auth on the main wallet
        return csWallet.auth({minData: true})
          .then(function() {
            csWallet.children.remove(wallet.id);
            UIUtils.loading.hide();
            $scope.updateView();
          })
          .catch(function(err) {
            if (err === 'CANCELLED') {
              return UIUtils.loading.hide();
            }
            UIUtils.onError('ERROR.ADD_SECONDARY_WALLET_FAILED')(err);
          });
      });
  };

  $scope.showImportFileModal = function() {
    $scope.hideActionsPopover();

    var loginAndAddWallet = function(authData) {
      console.debug("[wallet] Adding secondary wallet {"+authData.pubkey.substring(0,8)+"}");
      var wallet = csWallet.children.instance();
      return wallet.login({
          authData: authData,
          // Load data options :
          minData: true,
          sources: true,
          api: false,
          success: UIUtils.loading.show
        })
        .then(function(walletData) {
          walletData.localName = authData.localName;
          return $scope.addNewWallet(wallet);
        });
    };

    return ModalUtils.show(
        'templates/wallet/list/modal_import_file.html',
        'WalletListImportModalCtrl'
    )
      .then(function(items){
        if (!items || !items.length) return; // User cancel

        UIUtils.loading.show();
        // Make sure to auth on the main wallet
        return csWallet.auth({minData: true})
          .then(function() {
            // Add wallet one after one
            return items.reduce(function(promise, authData){
              return promise.then(function() {
                return loginAndAddWallet(authData);
              });
            }, $q.when());
          })
          .then(function() {
            UIUtils.loading.hide();
            $scope.updateView();
          })
          .catch(function(err) {
            if (err === 'CANCELLED') {
              return UIUtils.loading.hide();
            }
            UIUtils.onError('ERROR.ADD_SECONDARY_WALLET_FAILED')(err);
          });
      });
  };

  /* -- popups -- */

  $scope.setEditForm = function(editForm) {
    $scope.editForm = editForm;
  };

  $scope.showEditPopup = function(wallet) {
    return $q(function(resolve, reject) {
      $translate(['ACCOUNT.WALLET_LIST.EDIT_POPOVER.TITLE', 'ACCOUNT.WALLET_LIST.EDIT_POPOVER.HELP', 'COMMON.BTN_OK', 'COMMON.BTN_CANCEL'])
        .then(function (translations) {
          $scope.formData.name = wallet.data.localName || wallet.data.name || wallet.data.uid || wallet.data.pubkey.substring(0, 8);

          // Choose UID popup
          $ionicPopup.show({
            templateUrl: 'templates/wallet/list/popup_edit_name.html',
            title: translations['ACCOUNT.WALLET_LIST.EDIT_POPOVER.TITLE'],
            subTitle: translations['ACCOUNT.WALLET_LIST.EDIT_POPOVER.HELP'],
            scope: $scope,
            buttons: [
              { text: translations['COMMON.BTN_CANCEL'] },
              {
                text: translations['COMMON.BTN_OK'],
                type: 'button-positive',
                onTap: function(e) {
                  $scope.editForm.$submitted=true;
                  if(!$scope.editForm.$valid || !$scope.formData.name) {
                    //don't allow the user to close unless he enters a name
                    e.preventDefault();
                  } else {
                    return $scope.formData.name;
                  }
                }
              }
            ]
          })
            .then(function(name) {
              if (!name) { // user cancel
                delete $scope.formData.name;
                UIUtils.loading.hide();
                return;
              }
              resolve(name);
            });
        });
    });
  };

  /* -- popovers -- */

  $scope.showActionsPopover = function(event) {
    if (!$scope.actionsPopover) {
      $ionicPopover.fromTemplateUrl('templates/wallet/list/popover_actions.html', {
        scope: $scope
      }).then(function(popover) {
        $scope.actionsPopover = popover;
        //Cleanup the popover when we're done with it!
        $scope.$on('$destroy', function() {
          $scope.actionsPopover.remove();
        });
        $scope.actionsPopover.show(event);
      });
    }
    else {
      $scope.actionsPopover.show(event);
    }
  };

  $scope.hideActionsPopover = function() {
    if ($scope.actionsPopover) {
      $scope.actionsPopover.hide();
    }
  };

  /* -- listeners -- */

  // Clean controller data when logout
  $scope.onWalletLogout = function() {
    $scope.resetData();
    $scope.removeListeners();
  };

  $scope.addListeners = function() {

    // First remove lod listeners, if any
    $scope.removeListeners();

    $scope.listeners = [
      csWallet.api.data.on.logout($scope, $scope.onWalletLogout)
    ];

    // Auto-update on new block
    if (csSettings.data.walletHistoryAutoRefresh) {
      $scope.listeners.push(
        csCurrency.api.data.on.newBlock($scope, function (block) {
          if ($scope.loading) return;
          console.debug("[wallet-list] Received new block. Will reload list.");
          $timeout(function () {
            $scope.doUpdate(true);
          }, 300/*waiting for node cache propagation*/);
        }));
    }

    // Listen auth events on each wallet
    _.forEach($scope.wallets||[], $scope.addListenersOnWallet);
  };

  $scope.addListenersOnWallet = function(wallet) {
    if (!wallet) return;
    $scope.listeners.push(wallet.api.data.on.unauth($scope, $scope.updateView));
    $scope.listeners.push(wallet.api.data.on.auth($scope, function (data, deferred) {
      $timeout($scope.updateView);
      return deferred ? deferred.resolve() : $q.when();
    }));
  };

  $scope.removeListeners = function() {
    _.forEach($scope.listeners, function(remove){
      remove();
    });
    $scope.listeners = [];
  };

  var inheritedUpdateView = $scope.updateView;
  $scope.updateView = function() {
    inheritedUpdateView();
    $scope.$broadcast('$$rebind::' + 'rebind'); // force rebind
  };

  var inheritedUpdateWalletView = $scope.updateWalletView;
  $scope.updateWalletView = function(walletId) {
    inheritedUpdateWalletView(walletId);
    $scope.$broadcast('$$rebind::' + 'rebind'); // force rebind
  };

  // Detect changes in settings useRelative
  $scope.$watch('settings.useRelative', function(newVal, oldVal) {
    if (!$scope.formData || $scope.loading || (newVal === oldVal)) return;
    $scope.formData.useRelative = $scope.settings.useRelative;
    $scope.updateView();
  }, true);
}

function WalletSelectModalController($scope, $q, $timeout, UIUtils, filterTranslations, csSettings, csCurrency, csWallet, parameters){
  'ngInject';

  $scope.loading = true;
  $scope.wallets = null;
  $scope.formData = {
    useRelative: csSettings.data.useRelative,
    showDefault: true,
    showBalance: false,
    balance: undefined,
    updatingWalletId: undefined,
    stopped: false,
    minData: true
  };
  $scope.motion = null; // no animation

  $scope.setParameters = function(parameters) {
    parameters = parameters || {};

    $scope.formData.useRelative = angular.isDefined(parameters.useRelative) ? parameters.useRelative : $scope.formData.useRelative;

    $scope.formData.showDefault = angular.isDefined(parameters.showDefault) ? parameters.showDefault : $scope.formData.showDefault;

    $scope.formData.showBalance = angular.isDefined(parameters.showBalance) ? parameters.showBalance : $scope.formData.showBalance;

    $scope.formData.minData = angular.isDefined(parameters.minData) ? parameters.minData : $scope.formData.minData;
  };

  $scope.load = function(options) {

    options = options || {};
    $scope.loading = angular.isUndefined(options.silent) || !options.silent;
    $scope.formData.balance = undefined;
    $scope.formData.updatingWalletId = undefined;
    $scope.formData.stopped = false;

    // Load currency, and filter translations (need by 'formatAmount' filter)
    var jobs = [];

    jobs.push(csCurrency.name()
      .then(function(currency) {
        $scope.currency = currency;
        return filterTranslations.ready();
      }));

    // Get children wallets
    $scope.defaultWallet = $scope.formData.showDefault ? csWallet : undefined;
    if (!$scope.wallets) {
      jobs.push(
        csWallet.children.all()
          .then(function(children) {
            $scope.wallets=children;
            UIUtils.loading.hide();
          })
      );
    }

    // Prepare load options
    var walletLoadOptions = {
      silent: true,
      minData: $scope.formData.minData,
      sources: $scope.formData.showBalance,
      tx: {
        enable: false
      },
      api: true
    };
    var hasLoadError = false;
    var loadCounter = 0;
    var now = Date.now();
    var balance = 0;
    return (jobs.length ? $q.all(jobs) : $q.when())
      // Load wallet data (apply a timeout between each wallet)
      .then(function() {
        var wallets = $scope.formData.showDefault ? [csWallet].concat($scope.wallets) : $scope.wallets;
        if (!wallets.length) return;
        console.debug("[wallets] Loading {0} wallets...".format(wallets.length));
        return wallets.reduce(function(res, wallet) {
            var skip= !options.refresh && wallet.isDataLoaded(walletLoadOptions);
            if (skip) {
              console.debug("[wallets] Wallet #{0} already loaded. Skipping".format(wallet.id), walletLoadOptions);
              return res.then(function(){
                balance += wallet.data.balance;
                $scope.updateWalletView(wallet.id);
              });
            }
            loadCounter++;
            return res.then(function() {
              if ($scope.formData.stopped) return; // skip if stopped
              // Loading next wallet, after waiting some time
                $scope.formData.updatingWalletId = wallet.id;
                return (options.refresh || (walletLoadOptions.sources && !wallet.balance) ?
                  wallet.refreshData(angular.merge({
                    requirements: wallet.requirements && (wallet.requirements.isMember || wallet.requirements.wasMember || wallet.requirements.pendingMembership)
                  }, walletLoadOptions)) :
                  wallet.loadData(walletLoadOptions)
                ).then(function(walletData) {
                  balance += walletData.balance;
                  $scope.updateWalletView(wallet.id);
                })
                  .catch(function(err) {
                    console.error("[wallets] Error while loading data of wallet #{0}".format(wallet.id), err);
                    hasLoadError = true;
                  });
            });
          }, $q.when());
      })
      .then(function() {
        if (hasLoadError) {
          return UIUtils.alert.error('ERROR.LOAD_WALLET_LIST_FAILED')
            .then(function() {
              $scope.resetData();
              $scope.cancel();
            });
        }
        // Stop
        if ($scope.formData.stopped) return;
        if (loadCounter) {
          console.debug("[wallets] Loaded data of {0} wallet(s) in {1}ms".format(loadCounter, (Date.now() - now)));
        }
        $scope.formData.balance = balance;
        $scope.formData.updatingWalletId = undefined;
        $scope.loading = false;
        UIUtils.loading.hide();
        $scope.updateView();
      })
      .catch(function(err) {
        $scope.resetData();
        if (err && err === 'CANCELLED') {
          $scope.cancel();
          throw err;
        }
        return UIUtils.onError('ERROR.LOAD_WALLET_LIST_FAILED')(err);
      });
  };
  $scope.$on('modal.shown', $scope.load);

  $scope.cancel = function() {
    $scope.closeModal();
  };

  $scope.select = function($event, wallet) {
    $scope.closeModal(wallet);
  };

  // Clean controller data
  $scope.resetData = function() {
    $scope.wallets = null;
    $scope.loading = true;
    $scope.formData.balance = undefined;
    $scope.formData.updatingWalletId = undefined;
  };

  $scope.updateView = function(walletId) {
    if (!$scope.wallets || !$scope.wallets.length) return;

    var selectorSuffix = walletId && (' #wallet-' + walletId) || '';

    if ($scope.motion) {
      $scope.motion.show({selector: '.list .item.item-wallet' + selectorSuffix, ink: true});
    }
    else {
      UIUtils.ink({selector: '.list .item.item-wallet' + selectorSuffix});
    }
  };

  $scope.updateWalletView = function(walletId) {
    if ($scope.motion) {
      $scope.motion.show({selector: '.list #wallet-' + walletId, ink: true});
    }
    else {
      UIUtils.ink({selector: '.list #wallet-' + walletId});
    }
  };

  $scope.doUpdate = function(silent, event) {
    if ($scope.loading || !$scope.wallets || !$scope.wallets.length || $scope.formData.updatingWalletId) return $q.when();

    return $scope.load({silent: silent, refresh: true})
      .then(function() {
        $scope.loading = false;
        if (silent) {
          $scope.$broadcast('$$rebind::' + 'rebind'); // force rebind
        }
        $scope.updateView();
      });
  };

  // Default actions
  $scope.setParameters(parameters);

}

function PopoverWalletSelectModalController($scope, $controller, UIUtils) {
  'ngInject';

  // Initialize the super class and extend it.
  angular.extend(this, $controller('WalletSelectModalCtrl', {$scope: $scope, parameters: {
    showDefault: true,
    showBalance: false
  }}));

  // Disable list motion
  $scope.motion = null;

  $scope.$on('popover.shown', function() {
    if ($scope.loading) {
      $scope.load();
    }
  });

  $scope.updateView = function() {
    if (!$scope.wallets || !$scope.wallets.length) return;

    UIUtils.ink({selector: '.popover-wallets .list .item'});
  };

  $scope.select = function($event, wallet) {
    if ($event.preventDefault() || !wallet) return; // no selection
    $scope.closePopover(wallet);
  };
}

function WalletListImportModalController($scope, $timeout, BMA, csWallet) {
  'ngInject';

  $scope.hasContent = false;
  $scope.content = null;
  $scope.fileData =  '';
  $scope.isValidFile = false;
  $scope.validatingFile = false;

  $scope.importFromFile = function(file) {
    $scope.validatingFile = true;

    $scope.hasContent = angular.isDefined(file) && file !== '';
    $scope.fileData = file.fileData ? file.fileData : '';
    var isValidFile = $scope.fileData !== '' && ($scope.fileData.type == 'text/csv' || $scope.fileData.type == 'text/plain');

    // Bad file type: invalid file
    if (!isValidFile) {
      console.error("[wallet] Import failed. Invalid file type: " + $scope.fileData.type);
      $scope.isValidFile = false;
      $scope.validatingFile = false;
      return;
    }

    // Parse file
    console.debug("[wallet] Parsing file to import...");
    var rows = file.fileContent.split('\n');
    $scope.content = rows.reduce(function(res, row) {
      // Skip empty row
      if (!row || !row.trim().length) return res;

      // Split
      var cols = row.split('\t', 3) || undefined;

      // Invalid column count: mark file as invalid
      if (cols && cols.length != 3) {
        console.debug("[wallet] Import: skip invalid row: " + row);
        isValidFile = false;
        return res;
      }

      var item = {
        pubkey: cols[0],
        uid: cols[1],
        localName: cols[2]
      };

      // Check pubkey validity
      if (!BMA.regexp.PUBKEY.test(item.pubkey)) {
        console.debug("[wallet] Invalid pubkey, found in this row: ", row);
        isValidFile = false;
        return res;
      }

      // Ignore if same as current wallet
      if (csWallet.isUserPubkey(item.pubkey)) {
        console.debug("[wallet] Pubkey equals to main wallet. Skip this row: ", row);
        return res;
      }

      // Ignore if already in children wallet
      if (csWallet.children.hasPubkey(item.pubkey)) {
        console.debug("[wallet] Pubkey already in wallet list. Skip this row", row);
        return res;
      }

      // OK: add it to result
      return res.concat(item);
    }, []);

    $scope.isValidFile = isValidFile;

    $timeout(function() {
      $scope.validatingFile = false;
    }, 250); // need to have a loading effect
  };

  $scope.removeFile = function() {
    $scope.hasContent = false;
    $scope.content = null;
    $scope.fileData =  '';
    $scope.isValidFile = false;
    $scope.validatingFile = false;
  };
}
