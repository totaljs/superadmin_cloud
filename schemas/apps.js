const Fs = require('fs');
const Path = require('path');
const Exec = require('child_process').exec;

NEWSCHEMA('Apps', function(schema) {

	schema.define('id',             UID);
	schema.define('url',           'String', true);
	schema.define('name',          'String(50)');
	schema.define('category',      'String(50)');
	schema.define('redirect',      '[String]');
	schema.define('allow',         '[String]');
	schema.define('disallow',      '[String]');
	schema.define('ssl_key',        String);
	schema.define('ssl_cer',        String);
	schema.define('threads',        String);
	schema.define('note',           String);
	schema.define('startscript',    String);                   // A start script
	schema.define('nginx',          String);                   // Additional NGINX settings (lua)
	schema.define('delay',          Number);                   // Delay after start
	schema.define('memory',         Number);                   // Memory limit
	schema.define('priority',       Number);                   // Start priority
	schema.define('port',           Number);
	schema.define('cluster',       'String(4)');               // Thread count number or string - "auto"
	schema.define('ddos',           Number);                   // Maximum count of request per second
	schema.define('size',           Number);                   // Maximum size of request body (upload size)
	schema.define('proxytimeout',   Number);                   // Sets the "proxy_read_timeout"
	schema.define('debug',          Boolean);                  // Enables debug mode
	schema.define('subprocess',     Boolean);
	schema.define('accesslog',      Boolean);                  // Enables access_log
	schema.define('backup',         Boolean);                  // Enables backup
	schema.define('watcher',        Boolean);                  // Enables Total.js watcher for release mode
	schema.define('version',        String);                   // Total.js Version
	schema.define('highpriority',   Boolean);                  // App with high priority
	schema.define('unixsocket',     Boolean);                  // Enables unixsocket

	// TMS
	schema.jsonschema_define('userid', 'String');
	schema.jsonschema_define('username', 'String');
	schema.jsonschema_define('ua', 'String');
	schema.jsonschema_define('ip', 'String');
	schema.jsonschema_define('dtupdated', 'Date');
	schema.jsonschema_define('dttms', 'Date');

	schema.setQuery(function($) {
		$.callback(APPLICATIONS);
	});

	schema.setRead(function($) {
		var item = APPLICATIONS.findItem('id', $.id);
		if (item)
			$.callback(item);
		else
			$.invalid('404');
	});

	var obtaininginfo = false;

	// Reads info
	schema.addWorkflow('info', function($) {

		if (obtaininginfo) {
			$.success();
			return;
		}

		obtaininginfo = true;

		APPLICATIONS.wait(function(item, next) {

			if (MAIN.restarting) {
				next();
				return;
			}

			if (item.stopped) {

				if (MAIN.ws) {
					var current = {};
					current.id = item.id;
					current.TYPE = 'appinfo';
					current.is = false;
					MAIN.ws.send(current);
				}

				return setImmediate(next);
			}

			SuperAdmin.pid2(item, function(err, pid) {
				if (err) {
					SuperAdmin.run(item.port, () => next());
					SuperAdmin.notify(item, 0);
					SuperAdmin.wsnotify('app_restart', item);
					EMIT('superadmin_app_restart', item);
				} else
					SuperAdmin.appinfo(pid, next, item);
			});

		}, function() {
			obtaininginfo = false;
			SuperAdmin.savestats();
			$.success();
		}, 2);

	});

	// Analyzes logs
	schema.addWorkflow('analyzator', function($) {

		var output = [];
		var search = $.query && $.query.q ? [$.query.q.toLowerCase()] : ['\n======= ', 'obsolete', 'error', 'port is already in use', 'deprecationwarning'];
		var length = search.length;

		APPLICATIONS.wait(function(item, next) {

			if (item.stopped)
				return next();

			var type = 0;
			var filename = Path.join(CONF.directory_www, item.linker, 'logs', 'debug.log');
			var stream = Fs.createReadStream(filename);

			stream.on('data', U.streamer('\n', function(chunk) {

				if (type)
					return false;

				chunk = chunk.toLowerCase();

				for (var i = 0; i < length; i++) {
					if (chunk.indexOf(search[i]) !== -1) {
						type = search[i].startsWith('\n===') ? 'error' : search[i];
						return false;
					}
				}

			}));

			CLEANUP(stream, function() {

				if (type) {
					item.analyzatoroutput !== type && EMIT('superadmin_app_analyzator', item);
					item.analyzatoroutput = type;

					var e = { id: item.id, type: type, url: item.url };
					output.push(e);

					var publish = {};
					publish.id = e.id;
					publish.name = item.name;
					publish.category = item.category;
					publish.type = e.type;
					publish.url = e.url;
					publish.dterror = NOW;
					publish.dttms = NOW;
					PUBLISH('apps_analyzator', e);

				} else
					item.analyzatoroutput = null;

				next();
			});

		}, () => $.callback(output), 2);
	});

	// Reads logs
	schema.addWorkflow('logs', function($) {
		var item = APPLICATIONS.findItem('id', $.id);
		if (item) {
			Fs.readFile(Path.join(CONF.directory_www, item.linker, 'logs', 'debug.log'), function(err, response) {
				$.controller.plain(err ? '' : response.toString('utf8'));
				$.cancel();
			});
		} else
			$.invalid('404');
	});

	schema.addWorkflow('restart', function($) {

		var app = APPLICATIONS.findItem('id', $.id);
		if (!app) {
			$.invalid('404');
			return;
		}

		reset_alarms(app.id);

		SuperAdmin.logger('restart: {0}', $, app);
		EMIT('superadmin_app_restart', app);

		PUBLISH('apps_restart', FUNC.tms($, app));

		app.current = null;
		app.analyzatoroutput = null;

		if (app.stopped) {
			app.stopped = false;
			SuperAdmin.save();
		}

		SuperAdmin.wsnotify('app_restart', app);
		SuperAdmin.restart(app.port, $.successful(function() {
			SuperAdmin.pid2(app, function(err, pid) {
				pid && SuperAdmin.appinfo(pid, NOOP, app);
			});
		}));

		$.success();

	});

	schema.addWorkflow('restart_all', function($) {

		SuperAdmin.wsnotify('apps_restart');
		MAIN.restarting = true;

		PUBLISH('apps_restart_all', FUNC.tms($, {}));

		APPLICATIONS.wait(function(app, next) {

			if (app.stopped) {
				next();
				return;
			}

			console.log('here');

			reset_alarms(app.id);

			app.current = null;
			app.analyzatoroutput = null;
			SuperAdmin.wsnotify('app_restart', app);
			SuperAdmin.restart(app.port, () => next());

			PUBLISH('apps_restart', FUNC.tms($, app));

		}, function() {

			MAIN.restarting = false;

			// Obtain apps info
			$WORKFLOW('apps', 'info', NOOP);

		});

		$.success();

	});

	// Checks port number
	schema.addWorkflow('check', function($, model) {

		model.url = model.url.superadmin_clean();

		var item;
		if (model.subprocess) {
			item = APPLICATIONS.findItem(n => n.url === model.url && !n.subprocess);
			if (item)
				$.success();
			else
				$.invalid('404');
		} else {
			item = APPLICATIONS.findItem('url', model.url);
			if (item && item.id !== model.id)
				$.invalid('error-url-exists');
			else
				$.success();
		}
	});

	// Checks port number
	schema.addWorkflow('port', function($, model) {
		if (model.port) {
			if (port_check(APPLICATIONS, model.id, model.port)) {
				$.invalid('error-port');
				return;
			}
		} else
			model.port = port_create(APPLICATIONS);
		$.success();
	});

	function reset_alarms(appid) {
		MAIN.rules.wait(function(item, next) {
			delete item.appsnotified[appid];
			NOSQL('alarms').modify({ appsnotified: item.appsnotified }).id(item.id).callback(next);
		});
	}

	schema.setSave(function($, model) {

		var item = CLONE(model);
		var newbie = !model.id;

		item.linker = model.linker = item.url.superadmin_linker(model.path);

		if (!item.linker) {
			$.invalid('url');
			return;
		}

		if (item.version === 'total3')
			item.threads = '';

		item.restart = undefined;
		item.ssl = model.ssl = item.url.startsWith('https://');

		if ((item.unixsocket && item.version !== 'total4') || !CONF.unixsocket)
			item.unixsocket = false;

		if (item.id) {

			var index = APPLICATIONS.findIndex('id', model.id);

			if (index === -1) {
				$.invalid('404');
				return;
			}

			var app = APPLICATIONS[index];
			if (app.linker !== model.linker) {
				$.invalid('error-app-linker');
				return;
			}

			model.restart = app.cluster !== model.cluster || model.debug !== app.debug || model.version !== app.version || model.unixsocket !== app.unixsocket;
			item.current = app.current;
			item.analyzatoroutput = app.analyzatoroutput;
			item.dtupdated = NOW;

			PUBLISH('apps_update', FUNC.tms($, item));

		} else {
			item.id = model.id = UID();
			item.dtcreated = NOW;
			model.restart = true;

			PUBLISH('apps_insert', FUNC.tms($, item));

		}

		reset_alarms(item.id);

		FUNC.cloud_create(item, function(err) {

			if (err) {
				$.invalid(err);
				return;
			}

			if (newbie) {
				SuperAdmin.wsnotify('app_create', item);
				APPLICATIONS.push(item);
				EMIT('superadmin_app_create', item);
			} else {
				SuperAdmin.wsnotify('app_update', item);
				APPLICATIONS[index] = item;
				EMIT('superadmin_app_update', item, index);
			}

			item.current = null;
			item.analyzatoroutput = null;

			model.restart && SuperAdmin.restart(item.port, $.successful(function() {
				SuperAdmin.pid2(item, function(err, pid) {
					pid && SuperAdmin.appinfo(pid, NOOP, item);
				});
			}));

			SuperAdmin.save(null, true);
			$.success(item.id);
			MAIN.ws && MAIN.ws.send({ TYPE: 'refresh' });
		});
	});

	schema.setRemove(function($) {

		var index = APPLICATIONS.findIndex('id', $.id);
		if (index === -1) {
			$.invalid('404');
			return;
		}

		var app = APPLICATIONS[index];

		PUBLISH('apps_remove', FUNC.tms($, app));

		reset_alarms(app.id);

		SuperAdmin.kill(app.port, function() {

			var linker = app.linker;
			var directory = Path.join(CONF.directory_www, linker);

			// Backups application's data
			Exec('bash {0} {1} {2}'.format(PATH.private('backup.sh'), Path.join(CONF.directory_www, linker), Path.join(CONF.directory_dump, linker + '-removed-backup.tar.gz')), function() {
				Exec('rm -r ' + directory, function() {

					EMIT('superadmin_app_remove', app);

					APPLICATIONS.splice(index, 1);
					SuperAdmin.save(null, true);

					// Removes app directory
					Exec('rm ' + directory, NOOP);
					FUNC.cloud_remove(app, ERROR('cloud_remove'));

					$.success();
					MAIN.ws && MAIN.ws.send({ TYPE: 'refresh' });
				});
			});
		});
	});

	schema.addWorkflow('stop', function($) {

		var app = APPLICATIONS.findItem('id', $.id);
		if (!app) {
			$.invalid('404');
			return;
		}

		SuperAdmin.wsnotify('app_stop', app);
		SuperAdmin.logger('stop: {0}', $, app);
		SuperAdmin.kill(app.port, $.done());

		PUBLISH('apps_stop', FUNC.tms($, app));

		if (!app.stopped) {
			app.stopped = true;
			app.current = null;
			SuperAdmin.save(null, true);
		}

		if (MAIN.ws) {
			var current = {};
			current.id = app.id;
			current.TYPE = 'appinfo';
			current.is = false;
			current.analyzator = null;
			MAIN.ws.send(current);
		}

	});

	schema.addWorkflow('stop_all', function($) {

		SuperAdmin.wsnotify('apps_stop');
		SuperAdmin.logger('stops: all', $);

		PUBLISH('apps_stop_all', FUNC.tms($, {}));

		APPLICATIONS.wait(function(item, next) {

			if (item.stopped) {
				next();
				return;
			}

			item.stopped = true;
			item.current = null;

			PUBLISH('apps_stop', FUNC.tms($, item));

			SuperAdmin.kill(item.port, function() {
				if (MAIN.ws) {
					var current = {};
					current.id = item.id;
					current.TYPE = 'appinfo';
					current.analyzator = null;
					MAIN.ws.send(current);
				}
				next();
			});

		}, function() {
			SuperAdmin.save(null, true);
			$.success();
		});

	});


});

function port_create(arr) {
	var max = 8000;
	for (var i = 0; i < arr.length; i++) {
		var item = arr[i];
		if (item.port > max)
			max = item.port;
	}
	return max + 1;
}

function port_check(arr, id, number) {
	var item = arr.findItem('port', number);
	return item ? item.id !== id : false;
}
