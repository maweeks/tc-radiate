﻿var BuildScreenViewModel = function () {
    var self = this;

    function getNewDataModel() {
        var buildTypes = (function () {
            var isResultUpdate = false;
            var buildTypesFromApi = ko.observable({ isLoadingPlaceholder: true });

            var returnValue = ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildTypesUrl,
                            xhrFields: { withCredentials: true },
                            complete: function (xhr) {
                                var data = xhr.status === 200 ? xhr.responseJSON.buildType : { isError: true };
                                try {
                                    isResultUpdate = true;
                                    buildTypesFromApi(data);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return buildTypesFromApi().isLoadingPlaceholder || buildTypesFromApi().isError ? buildTypesFromApi() : _(buildTypesFromApi()).map(function (buildTypeFromApi) {
                        buildTypeFromApi.branches = getBranchesForBuildTypeObservable(buildTypeFromApi);
                        return buildTypeFromApi;
                    });
                },
                deferEvaluation: true
            });

            returnValue.update = function() {
                buildTypesFromApi([]);
            };

            return returnValue;
        })();

        function getBranchesForBuildTypeObservable(buildType) {
            var branchesFromApi = ko.observable({ isLoadingPlaceholder: true });

            var isResultUpdate = false;
            return ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildTypesUrl + '/id:(' + buildType.id + ')' + '/branches?' + Utils.getTsQSParam(),
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                // TODO #HandleErrors
                                try {
                                    isResultUpdate = true;
                                    var branches = [{ isNoBranchPlaceHolder: true }];
                                    branches = branches.concat(data.branch);
                                    branchesFromApi(branches);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return branchesFromApi().isLoadingPlaceholder ? branchesFromApi() : _(branchesFromApi()).map(function (branchFromApi) {
                        branchFromApi.buildType = buildType;
                        branchFromApi.builds = getBuildsForBranchObservable(branchFromApi);
                        return branchFromApi;
                    }).filter(Settings.branchFilter || function() { return true; });
                }
            });
        }

        function getBuildsForBranchObservable(branch) {
            var buildsFromApi = ko.observable({ isLoadingPlaceholder: true });

            var isResultUpdate = false;
            var builds = ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.buildsUrl + ',buildType:(id:(' + branch.buildType.id + ')),branch(' + (branch.isNoBranchPlaceHolder ? 'branched:false' : ('name:' + branch.name)) + '),count:1&fields=build(id,buildTypeId,number,status,state,running,percentageComplete,branchName,href,webUrl,startDate)' + Utils.getTsQSParam(),
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                try {
                                    // TODO #HandleErrors
                                    isResultUpdate = true;
                                    buildsFromApi(data.build || []);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return buildsFromApi().isLoadingPlaceholder ? buildsFromApi() : ko.utils.arrayMap(buildsFromApi(), function (build) {
                        return new SingleBuildViewModel(build, buildTypes());
                    });
                }
            });
            return builds;
        }

        var projects;

        var allBuildsOfAllProjectsOrPlaceholders = ko.computed({
            read: function () {
                return projects().isLoadingPlaceholder || projects().isError ? [projects()] : (_(projects()).chain()
                    .map(function (project) {
                        return project.buildTypes.isLoadingPlaceholder ? project.buildTypes : _(project.buildTypes).map(function (buildType) {
                            return buildType.branches().isLoadingPlaceholder ? buildType.branches() : _(buildType.branches()).map(function (branch) {
                                return branch.builds();
                            });
                        });
                    }).flatten().value());
            },
            deferEvaluation: true
        });
        return {
            projects: projects = ko.computed({
                read: function () {
                    return buildTypes().isLoadingPlaceholder || buildTypes().isError ? buildTypes() : _(buildTypes()).chain().groupBy(function (buildType) {
                        return buildType.projectId;
                    }).mapObject(function (buildTypes, projectId) {
                        return {
                            projectId: projectId,
                            projectName: buildTypes[0].projectName,
                            buildTypes: buildTypes
                        };
                    })
                        .value()
                    ;
                },
                deferEvaluation: true
            }),
            allLoadedBuildsOfAllProjects: ko.computed({
                    read: function () {
                        return allBuildsOfAllProjectsOrPlaceholders().filter(function (build) { return !build.isLoadingPlaceholder && !build.isError; });
                    },
                    deferEvaluation: true
                }),
            isInitializing: ko.computed({
                read: function () {
                    return !!_(allBuildsOfAllProjectsOrPlaceholders()).findWhere({ isLoadingPlaceholder: true });
                },
                deferEvaluation: true
            }),
            isError: ko.computed({
                read: function() {
                    return projects().isError;
                },
                deferEvaluation: true
            })
        };
    };

    var currentViewDataModel = ko.observable(getNewDataModel());

    self.isFirstLoad = ko.computed(function() {
        return currentViewDataModel().isInitializing();
    });

    var buildFilterExcludeProperties = Utils.getObservableArrayBackedByStorage(/*storage:*/ window.localStorage, /*storageKey:*/ getAppStorageKey('buildFilterExcludeProperties'));
    var buildFilterExcludeFunctions = ko.computed(function () {
        return _(buildFilterExcludeProperties()).map(function(buildToExcludeProps) {
            return function(buildToTest) {
                return ((!buildToExcludeProps.branchName && !buildToTest.branchName) || (buildToTest.branchName && buildToTest.branchName() === buildToExcludeProps.branchName)) && buildToTest.buildTypeId() === buildToExcludeProps.buildTypeId;
            };
        });

    });

    self.excludedBuilds = {
        get length() { return buildFilterExcludeProperties().length },
        push: function (build) {
            buildFilterExcludeProperties.push({
                branchName: build.branchName && build.branchName(),
                buildTypeId: build.buildTypeId()
            });
        },
        removeAll: function () {
            buildFilterExcludeProperties.removeAll();
        }
    };

    self.builds = ko.computed({
        read: function () {
            return _(currentViewDataModel().allLoadedBuildsOfAllProjects()).chain().filter(function (build) {
                return _(buildFilterExcludeFunctions()).any(function (shouldExclude) { return shouldExclude(build); }) === false;
            })
            .sortBy(function (build) { return (build.status() !== 'SUCCESS' ? (build.isRunning() ? 4 : 3) : (build.isRunning() ? 2 : 1)) + '_' + build.startDate(); })
            .value()
            .reverse();
        },
        deferEvaluation: true
    });

    self.mainBuild = (function () {
        var isResultUpdate = false;
        var lastMainBuild = undefined;

        var mainBuildFromApi = ko.observable();
        var lastBuildId;

        var timeOfLastNotifyOfMainBuild = Utils.getObservableBackedByStorage(
            /*storage:*/ window.sessionStorage, // So that refreshing the same tab doesn't makes us notify again (e.g. play the sound), but if we restart the browser or use a new tab, we get fresh notifications.
            /*storageKey:*/ 'timeOfLastNotifyOfMainBuild'
            );

        ko.computed({
            read: function () {
                var url = null;
                if (Settings.mainBranch)
                    url = getBuildStatusUrlForBranch(Settings.mainBranch);
                else {
                    var buildId = self.builds().length && (_(self.builds()).find(function (build) {
                            return build.status() === 'FAILURE';
                        }) || self.builds()[0]).id();
                    if (!self.isFirstLoad() && buildId && buildId !== lastBuildId) {
                        lastBuildId = buildId;
                        url = getBuildStatusUrlForBuildId(buildId);
                    }
                }

                if (url && !isResultUpdate) {
                    $.ajax({
                        dataType: "json",
                        url: url + '?' + Utils.getTsQSParam(),
                        xhrFields: { withCredentials: true },
                        success: function (build, status, xhr) {
                            try {
                                // TODO #HandleErrors
                                isResultUpdate = true;
                                if (lastMainBuild === xhr.responseText)
                                    return;
                                lastMainBuild = xhr.responseText;

                                build.isNew = !timeOfLastNotifyOfMainBuild() || (build.startDate > timeOfLastNotifyOfMainBuild());

                                timeOfLastNotifyOfMainBuild(build.startDate);

                                var mainBuildModel = ko.mapping.fromJS(build, {
                                    create: function(options) {
                                        return new MainBuildViewModel(options.data);
                                    }
                                });

                                mainBuildModel.investigations = getInvestigationsForBuildType(build.buildTypeId);


                                mainBuildModel.changes = (function () {
                                    var changesFromApi = ko.observable([]);
                                    var isResultUpdate = false;

                                    return ko.computed({
                                        read: function () {
                                            if (!isResultUpdate) {
                                                $.ajax({
                                                    dataType: "json",
                                                    url: Settings.teamCityBaseUrl + build.changes.href + Utils.getTsQSParam(),
                                                    xhrFields: { withCredentials: true },
                                                    success: function (changesResult) {
                                                        try {
                                                            // TODO #HandleErrors
                                                            isResultUpdate = true;
                                                            changesFromApi(changesResult.change || []);
                                                        } finally {
                                                            isResultUpdate = false;
                                                        }
                                                    }
                                                });
                                            }
                                            return changesFromApi();
                                        },
                                        deferEvaluation: true
                                    });
                                })();

                                mainBuildFromApi(mainBuildModel);
                            } finally {
                                isResultUpdate = false;
                            }
                        }
                    });
                }

                return mainBuildFromApi();
            }
        });

        function getInvestigationsForBuildType(buildTypeId) {
            var investigationsFromApi = ko.observable([]);
            var isResultUpdate = false;
            return ko.computed({
                read: function () {
                    if (!isResultUpdate) {
                        $.ajax({
                            dataType: "json",
                            url: Settings.restApiBaseUrl + '/investigations?locator=buildType:(id:(' + buildTypeId + '))' + Utils.getTsQSParam(),
                            xhrFields: { withCredentials: true },
                            success: function (data) {
                                try {
                                    // TODO #HandleErrors
                                    isResultUpdate = true;
                                    investigationsFromApi(data.investigation);
                                } finally {
                                    isResultUpdate = false;
                                }
                            }
                        });
                    }

                    return investigationsFromApi();
                },
                deferEvaluation: true
            });

        }
        return mainBuildFromApi;
    })();


    self.audio = {
        volume: Utils.getObservableBackedByStorage(window.localStorage, 'audio.volume', 1),
        isMuted: Utils.getObservableBackedByStorage(window.localStorage, 'audio.isMuted', false)
    };

    self.errorMessage = ko.observable();

    var imageUpdateTickSource = ko.observable();

    self.getImageForStatus = function(status) {
        return ko.computed(function() {
            imageUpdateTickSource();
            return Images[status].getRandom();
        });
    }

    function updateData() {
        var newDataModel = getNewDataModel();
        newDataModel.isInitializing.subscribe(function (isInitializing) {
            if (!isInitializing) {
                currentViewDataModel(newDataModel);
                ensureDataAutoUpdate();
            }
        });
    }

    function ensureDataAutoUpdate() {
        if (Settings.enableAutoUpdate)
            setTimeout(updateData, Settings.dataUpdateIntervalMs);
    }

    self.init = function () {
        setInterval(function () { imageUpdateTickSource(!imageUpdateTickSource()); }, Settings.buildImageIntervalMs);
        ensureDataAutoUpdate();
        if (Settings.enableAutoUpdate && Settings.appUpdateIntervalMs)
            setTimeout(function() { location.reload(/*withoutCache*/ true); }, Settings.appUpdateIntervalMs);
    };

    self.init();
};
