global.APPLICATIONS = [];

const Url = require('url');
const Fs = require('fs');
const Path = require('path');
const Exec = require('child_process').exec;
const Spawn = require('child_process').spawn;
const SuperAdmin = global.SuperAdmin = {};

const REG_EMPTY = /\s{2,}/g;
const REG_APPDISKSIZE = /^[\d.,]+/;
const REG_FINDVERSION = /[0-9.]+/;

if (!CONF.cdn)
	CONF.cdn = '//cdn.componentator.com';

SuperAdmin.server = { version_superadmin: 9, cpu: 0, cpucores: [] };
SuperAdmin.options = {};

SuperAdmin.wsnotify = function(type, app, msg) {

	var data = {};
	data.TYPE = type;

	if (msg)
		data.msg = msg;

	if (app) {
		data.id = app.id;
		data.url = app.url;
	}

	MAIN.ws && MAIN.ws.send(data);
};

var user;
try {
	var tmp = Fs.readFileSync('/www/superadmin/user.guid', 'utf8').split('\n')[0].split(':');
	if (tmp.length === 3)
		user = { user: tmp[0], id: parseInt(tmp[1]), group: parseInt(tmp[2]) };
} catch (err) {}

SuperAdmin.run_as_user = user || { user: 'root', id: 0, group: 0 };

/**
 * Gets CPU/Memory, OpenFiles and Network connections
 * @param {Number} pid
 * @param {Function(err, info)} callback
 */
SuperAdmin.appinfo = function(pid, callback, app) {

	var arr = [];
	app = app ? app : APPLICATIONS.findItem('pid', pid);

	if (!app) {
		callback('404');
		return;
	}

	if (!app.stats)
		app.stats = {};

	var current = app.current ? app.current : (app.current = {});

	if (current.interval)
		current.interval++;
	else
		current.interval = 0;

	current.cluster = app.cluster;
	current.port = app.port;
	current.pid = pid;
	current.is = true;

	// Get basic information
	arr.push(function(next) {
		Exec('ps -p {0} -o %cpu,rss,etime'.format(pid), function(err, response) {

			if (err) {
				next();
				return;
			}

			var line = response.split('\n')[1];
			line = line.trim().replace(REG_EMPTY, ' ').split(' ');
			var cpu = line[0].parseFloat();

			current.cpu = cpu.floor(1);
			current.memory = line[1].parseInt2() * 1024; // kB to bytes
			current.time = line[2];

			app.stats.cpu = Math.max(app.stats.cpu || 0, cpu);
			app.stats.memory = Math.max(app.stats.memory || 0, current.memory);
			next();
		});
	});

	// Get count of open files
	arr.push(function(next) {
		Exec('ls /proc/{0}/fd/ | wc -l'.format(pid), function(err, response) {

			if (!err) {
				current.openfiles = response.trim().parseInt2();
				app.stats.openfiles = Math.max(app.stats.openfiles || 0, current.openfiles);
			}

			next();
		});
	});

	// Get count of opened network connections
	arr.push(function(next) {
		Exec('netstat -an | grep :{0} | wc -l'.format(app.port), function(err, response) {

			if (err) {
				next();
				return;
			}

			current.connections = response.trim().parseInt2() - 1;

			if (current.connections < 0)
				current.connections = 0;

			app.stats.connections = Math.max(app.stats.connections || 0, current.connections);
			next();
		});
	});

	// Get directory size
	arr.push(function(next) {

		if (current.interval % 5 !== 0) {
			next();
			return;
		}

		Exec('du -hsb {0}'.format(Path.join(CONF.directory_www, app.linker)), function(err, response) {

			if (err) {
				next();
				return;
			}

			var match = response.trim().match(REG_APPDISKSIZE);
			if (match) {
				current.hdd = match.toString().trim().parseInt2();
				app.stats.hdd = Math.max(app.stats.hdd || 0, current.hdd);
			}
			next();
		});
	});

	// Get SSL expiration
	arr.push(function(next) {

		if (current.interval % 5 !== 0) {
			if (!current.sslcheckforce) {
				next();
				return;
			}
		} else if (!app.url.startsWith('https://')) {
			current.sslexpire = undefined;
			current.sslexpirerenew = undefined;
			next();
			return;
		}

		var name = app.url.superadmin_url();
		current.sslcheckforce = false;

		Exec('cat {0} | openssl x509 -noout -enddate'.format(app.ssl_cer ? app.ssl_cer : Path.join(CONF.directory_ssl, name, name + '.cer')), function(err, response) {

			if (err) {
				next();
				return;
			}

			var index = response.indexOf('=');
			if (index === -1) {
				next();
				return;
			}

			// current.sslexpire = new Date(Date.parse(response.substring(index + 1).trim()));
			// current.sslexpirecan = app.ssl_cer ? false : current.sslexpire.diff('days') < 6;
			current.sslexpirecan = false;
			next();
		});
	});

	arr.push(function(next) {
		SuperAdmin.notify(app, 1);
		next();
	});

	arr.async(function() {

		current.analyzator = app.analyzatoroutput || '';
		callback && setTimeout(callback, 500, null, current);

		if (MAIN.ws) {
			current.id = app.id;
			current.TYPE = 'appinfo';
			MAIN.ws.send(current);
		}

	});
	return SuperAdmin;
};

SuperAdmin.sysinfo = function(callback) {

	var arr = [];

	if (SuperAdmin.server.index === undefined) {
		SuperAdmin.server.index = 0;
		SuperAdmin.server.TYPE = 'sysinfo';
	} else
		SuperAdmin.server.index++;

	arr.push(function(next) {

		if (SuperAdmin.server.index % 6 !== 0) {
			next();
			return;
		}

		Exec('free -b -t', function(err, response) {

			if (err) {
				next();
				return;
			}

			var memory = response.split('\n')[1].match(/\d+/g);
			SuperAdmin.server.memtotal = memory[0].parseInt();
			SuperAdmin.server.memfree = memory[2].parseInt() + memory[4].parseInt();
			SuperAdmin.server.memused = memory[1].parseInt();
			next();
		});
	});

	arr.push(function(next) {

		if (SuperAdmin.server.index % 6 !== 0) {
			next();
			return;
		}

		Exec('df -hTB1 {0}'.format(CONF.directory_www), function(err, response) {

			if (err) {
				next();
				return;
			}

			response.parseTerminal(function(info) {
				SuperAdmin.server.hddtotal = info[2].parseInt();
				SuperAdmin.server.hddfree = info[4].parseInt();
				SuperAdmin.server.hddused = info[3].parseInt();
			}, 1);

			next();
		});
	});

	arr.push(function(next) {
		Exec('ps aux | wc -l', function(err, response) {
			SuperAdmin.server.processes = +response.trim();
			next();
		});
	});

	arr.push(function(next) {

		if (SuperAdmin.server.index % 20 !== 0) {
			next();
			return;
		}

		Exec('uptime -s', function(err, response) {
			SuperAdmin.server.uptime = response.replace(' ', 'T').parseDate().diff('seconds') * -1;
			next();
		});
	});

	arr.push(function(next) {

		if (SuperAdmin.server.index % 20 !== 0) {
			next();
			return;
		}

		Exec('curl ifconfig.me', function(err, response) {
			if (response)
				SuperAdmin.server.ip = response;
			next();
		});
	});

	arr.async(function() {
		SuperAdmin.server.superadmin = process.memoryUsage().heapUsed;
		EMIT('superadmin_sysinfo', SuperAdmin.server);
		callback && callback(null, SuperAdmin.server);
		MAIN.ws && MAIN.ws.send(SuperAdmin.server);
		SuperAdmin.notify_system();
	});

};

/**
 * Gets PID by PORT number
 * @param {Number} port
 * @param {Function(err, pid)} callback
 */
SuperAdmin.pid = function(port, callback) {

	var item = APPLICATIONS.findItem('port', port);
	if (!item) {
		callback(null, '404');
		return;
	}

	var pidfilename = Path.join(CONF.directory_www, item.linker, 'superadmin.pid');
	Fs.readFile(pidfilename, function(err, buffer) {
		if (buffer) {
			var pid = buffer.toString('ascii');
			Exec('ps -p ' + pid, err => callback(err, err ? null : pid, item));
		} else
			callback('500', null, item);
	});

	/*
	Exec('lsof -i :' + port + ' | grep \'LISTEN\'', function(err, response) {
		var pid = response.match(REG_PID);
		if (pid) {
			item.pid = pid.toString().trim();
			callback(null, item.pid, item);
		} else
			callback(err, null, item);
	});*/

	return SuperAdmin;
};

/**
 * Get PID (cached)
 * @param {Application} app
 * @param {Function(err, pid)} callback
 * @return {SuperAdmin}
 */
SuperAdmin.pid2 = function(app, callback) {
	if (app.pid && app.current && app.current.interval % 5 !== 0)
		callback(null, app.pid);
	else
		SuperAdmin.pid(app.port, callback);
	return SuperAdmin;
};

/**
 * Runs application
 * @param {String} url
 * @param {Number} port
 * @param {Boolean} debug
 * @param {Function} callback
 */
SuperAdmin.run = function(port, callback) {

	var app = APPLICATIONS.findItem('port', port);
	if (!app) {
		callback('404');
		return;
	}

	var filename = 'index.js';
	var linker = app.linker;
	var log = Path.join(CONF.directory_www, linker, 'logs', 'debug.log');

	!app.debug && Exec('bash {0} {1} {2}'.format(PATH.private('backuplogs.sh'), log, Path.join(CONF.directory_console, linker + NOW.format('yyyyMMdd-HHmm') + '.log')), NOOP);

	// Reset output of analyzator
	app.analyzatoroutput = null;

	var fn = function(callback) {
		SuperAdmin.makescripts(app, function() {
			// Creates a log directory
			Exec('bash {0} {1}'.format(PATH.private('mkdir.sh'), Path.join(CONF.directory_www, linker, 'logs')), callback);
		});
	};

	app.pid = 0;

	if (app.current)
		app.current = null;

	// Because of backuping logs
	setTimeout(function() {
		PATH.unlink([log], function() {
			fn(function() {

				filename = Path.join(CONF.directory_www, linker, app.startscript || filename);
				PATH.exists(filename, function(e) {

					if (!e) {
						callback && callback(new Error('Start script doesn\'t exist ({0}).'.format(linker)));
						return;
					}

					var options = ['--nouse-idle-notification', '--expose-gc'];

					app.memory && options.push('--max_old_space_size=' + app.memory);
					options.push(filename);

					if (!CONF.unixsocket || !app.unixsocket)
						options.push(app.port);

					options.push(app.debug ? '--debug' : '--release');

					if (!app.debug && app.watcher)
						options.push('--watcher');

					var p = Spawn('node', options, {
						stdio: ['ignore', Fs.openSync(log, 'a'), Fs.openSync(log, 'a')],
						cwd: Path.join(CONF.directory_www, linker),
						detached: true,
						uid: SuperAdmin.run_as_user.id,
						gid: SuperAdmin.run_as_user.group
					});

					Fs.writeFile(Path.join(CONF.directory_www, linker, 'superadmin.pid'), p.pid + '', NOOP);
					p.unref();

					EMIT('superadmin_app_run', app);
					callback && setTimeout(callback, app.delay || 1000);
				});
			});
		});
	}, 500);

	return SuperAdmin;
};

SuperAdmin.restart = function(port, callback) {
	return SuperAdmin.kill(port, function() {
		SuperAdmin.run(port, callback);
	});
};

SuperAdmin.npminstall = function(app, callback) {
	var directory = Path.join(CONF.directory_www, app.linker);
	F.path.exists(Path.join(directory, 'package.json'), function(e) {
		if (e)
			Exec('bash {0} {1}'.format(PATH.private('npminstall.sh'), directory), (err) => callback(err));
		else
			callback();
	});
	return SuperAdmin;
};

/**
 * Kills application
 * @param {Number} port
 * @param {Function(err)} callback
 */
SuperAdmin.kill = function(port, callback) {
	return SuperAdmin.pid(port, function(err, pid, app) {
		if (pid) {
			EMIT('superadmin_app_kill', app);
			Exec('kill ' + pid, () => callback(null, SUCCESS(true)));
		} else
			callback(err);
	});
};

SuperAdmin.versions = function(callback) {

	var arr = [];

	arr.push(function(next) {
		Exec('lsb_release -a', function(err, stdout) {

			if (err) {
				next();
				return;
			}

			var index = stdout.indexOf('Description:');
			if (index === -1) {
				next();
				return;
			}

			SuperAdmin.server.version_server = stdout.substring(index + 12, stdout.indexOf('\n', index)).trim();
			next();
		});
	});

	arr.push(function(next) {
		Exec('node --version', function(err, stdout) {

			if (err) {
				next();
				return;
			}

			var version = stdout.trim().match(REG_FINDVERSION);
			if (version)
				SuperAdmin.server.version_node = version.toString();

			next();
		});
	});

	arr.push(function(next) {
		Exec('gm -version', function(err, stdout) {

			if (err) {
				next();
				return;
			}

			var version = stdout.trim().match(REG_FINDVERSION);
			if (version)
				SuperAdmin.server.version_gm = version.toString();

			next();
		});
	});

	arr.async(function() {
		EMIT('superadmin.system', SuperAdmin.server);
		callback();
	});

	return SuperAdmin;
};

SuperAdmin.backup = function(callback) {
	var filename = NOW.format('yyyyMMdd') + '-backup.tar.gz';
	Exec('bash {0} {1} {2}'.format(PATH.private('backup.sh'), CONF.directory_dump, filename), function(err) {
		callback(err, Path.join(CONF.directory_dump, filename));
	});
};

SuperAdmin.backupapp = function(app, callback) {

	if (!CONF.allowbackup || !app.backup) {
		callback(new Error('Backup is not allowed'));
		return;
	}

	var filename = Path.join(CONF.directory_dump, NOW.format('yyyyMMddHHmmss') + '_' + app.linker + '-backup.tar.gz');
	Exec('bash {0} {1} {2}'.format(PATH.private('backup.sh'), CONF.directory_www + app.linker + '/', filename), function(err) {
		SuperAdmin.ftp(filename, function() {
			SuperAdmin.logger('backuped: ' + filename, null, app);
			EMIT('superadmin_app_backup', app, filename);
			callback && callback(err, filename);
		});
	});
};

SuperAdmin.ftp = function(filename, callback) {

	var ftp = Url.parse(CONF.ftp);
	var auth = ftp.auth.split(':');
	var username = auth[0];
	var password = auth[1];
	var target = U.getName(filename);

	Exec('bash {0} {1} {2} {3} {4} {5}'.format(PATH.private('ftp.sh'), ftp.hostname, username, password, filename, target), function(err) {
		Fs.unlink(filename, NOOP);
		callback && callback(err);
	});
};

SuperAdmin.save = function(callback, stats) {

	APPLICATIONS.quicksort('priority_desc');

	for (var i = 0; i < APPLICATIONS.length; i++) {
		var app = APPLICATIONS[i];
		if (app.current) {
			delete app.current.TYPE;
			delete app.current.id;
			delete app.current.analyzator;
		}
	}

	var content = JSON.stringify(APPLICATIONS);
	Fs.writeFile(PATH.databases('applications.json'), content, callback || NOOP);
	stats && Fs.appendFile(PATH.databases('applications.backup'), NOW.format('yyyy-MM-dd HH:mm') + ' | ' + content + '\n', callback || NOOP);
	return SuperAdmin;
};

SuperAdmin.savestats = function(callback) {

	var updated = PREF.stats_update;

	if (updated === undefined) {
		PREF.set('stats_update', NOW);
		callback && callback(null, false);
		return SuperAdmin;
	}

	if (updated.getDate() === NOW.getDate()) {
		callback && callback(null, false);
		return SuperAdmin;
	}

	var db = NOSQL('stats');
	var builder = [];

	for (var i = 0; i < APPLICATIONS.length; i++) {

		var item = APPLICATIONS[i];
		if (!item.stats || !item.current)
			continue;

		item.current.interval = 0;

		var stats = CLONE(item.stats);
		delete stats.TYPE;
		stats.id = stats.id;
		stats.url = item.url;
		stats.datecreated = NOW;

		db.insert(stats);
		builder.push(stats);
		item.stats = {};
	}

	if (CONF.emailsummarization && builder.length) {
		builder.date = NOW.add('-1 day');
		var addresses = CONF.emailsummarization.split(',').trim();
		var msg = MAIL(addresses[0], CONF.name + ': @(Daily summarization) - ' + builder.date.format('dd. MMMM yyyy'), 'mails/summarization', builder, '');
		for (var i = 1; i < addresses.length; i++)
			msg.to(addresses[i]);
	}

	PREF.set('stats_update', NOW);
	callback && callback(null, true);
	return SuperAdmin;
};

SuperAdmin.load = function(callback) {
	Fs.readFile(PATH.databases('applications.json'), function(err, response) {

		response && (APPLICATIONS = response.toString('utf8').parseJSON(true));

		// Resets PID
		for (var i = 0; i < APPLICATIONS.length; i++) {
			var item = APPLICATIONS[i];
			item.pid = 0;
			item.linker = item.url.superadmin_linker(item.path);
			!item.priority && (item.priority = 0);
			!item.delay && (item.delay = 0);
			!item.analyzatoroutput && (item.analyzatoroutput = null);
			if (item.version == null) {
				if (item.startscript === 'index.js') {
					item.version = 'total4';
					item.startscript = '';
				} else if (item.startscript)
					item.version = '';
				else
					item.version = 'total3';
			}
		}

		// RUNS APPLICATIONS
		APPLICATIONS.quicksort('priority_desc');
		callback && callback();
	});

	return SuperAdmin;
};

/**
 * Makes executables
 * @param {Application} app
 * @param {Function(err)} callback
 * @return {SuperAdmin}
 */
SuperAdmin.makescripts = function(app, callback) {

	if (app.version === '' && app.startscript) {
		callback();
		return;
	}

	var data = {};

	data.total = app.version === 'total3' ? 'total.js' : app.version;
	data.threads = app.threads ? app.threads === '-' ? 'true' : ('\'' + app.threads + '\'') : '';

	// Old format
	if (typeof(app.cluster) === 'number') {
		app.cluster = app.cluster + '';
	}

	data.cluster = app.cluster;

	if (!data.cluster || data.cluster === '1') {
		data.cluster = 0;
	} else {
		if (data.cluster === 'auto')
			data.cluster = '\'auto\'';
		else
			data.cluster = data.cluster.parseInt();

		if (data.cluster === 0)
			data.cluster = '';
	}

	data.unixsocket = CONF.unixsocket && app.unixsocket ? Path.join(CONF.directory_www, app.linker, 'superadmin.socket') : null;

	// data.cluster = data.threads ? app.cluster <= 1 || app.cluster === 'auto' ? '\'auto\'' : app.cluster : 0;
	var linker = app.linker;
	var directory = Path.join(CONF.directory_www, linker);
	Exec('mkdir -p ' + directory, function() {
		Exec('chmod 777 {0}'.format(directory), function() {
			SuperAdmin.copy(PATH.private('index.js'), Path.join(directory, 'index.js'), function(err) {
				callback(err);
			}, (response) => Tangular.render(response.toString('utf8'), { value: data }).replace(/\n{3,}/g, '\n\n'));
		});
	});
	return SuperAdmin;
};

SuperAdmin.copy = function(filename, target, callback, prepare) {
	Fs.readFile(filename, function(err, response) {
		if (err)
			callback(err);
		else
			Fs.writeFile(target, prepare ? prepare(response) : response, callback || NOOP);
	});
	return SuperAdmin;
};

SuperAdmin.init = function() {
	$WORKFLOW('Settings', 'load', function() {
		EMIT('settings');
		SuperAdmin.load(function() {
			SuperAdmin.versions(function() {
				APPLICATIONS.wait(function(item, next) {

					if (item.stopped) {
						next();
						return;
					}

					SuperAdmin.pid(item.port, function(err, pid) {
						if (pid)
							next();
						else
							SuperAdmin.run(item.port, () => next());
					});
				});

				// Runs sys info
				setInterval(SuperAdmin.sysinfo, 30000);
				SuperAdmin.sysinfo();
			});
		});
	});

	SuperAdmin.logger('init: SuperAdmin');
	return SuperAdmin;
};

SuperAdmin.logger = function(message, controller, id) {

	var app;

	if (id) {

		// id == App
		if (typeof(id.id) === 'string')
			app = id;
		else
			app = APPLICATIONS.findItem('id', id);

		if (app)
			message = message.format('"' + app.url + '"' + ' --> #' + app.id);
		else
			return SuperAdmin;

	}

	message && LOGGER('logger', controller && controller.user ? ('[' + controller.user.name + ']') : '[nobody]', message, controller ? controller.ip : 'root');
	return SuperAdmin;
};

SuperAdmin.notify = function(app, type, callback) {

	// type = 0    - application has been offline, restarting...
	// type = 1    - application info read from system (app.current)
	// type = 2    - application monitoring (app.currentmonitor)
	// type = 3    - analyzator

	if (!MAIN.rules || !MAIN.rules.length) {
		callback && callback();
		return;
	}

	var skip = {};

	MAIN.rules.wait(function(item, next) {

		var key = 'delay' + (item.each ? app.id + item.id : item.id);

		if ((item.appid && item.appid !== app.id) || skip[key] || item[key] > NOW || (!item.debug && app.debug) || (item.highpriority && !app.highpriority)) {
			next();
			return;
		}

		if (!app.current)
			app.current = {};

		if (!app.stats)
			app.stats = {};

		if (item.validate(app)) {

			skip[key] = true;
			item[key] = NOW.add(item.delay);

			var data = [];
			data.push('CPU: ' + app.current.cpu + '%');
			data.push('RAM: ' + app.current.memory.filesize());
			data.push('HDD: ' + app.current.memory.filesize());
			data.push('HTTP: ' + app.current.connections);
			data.push('FILES: ' + app.current.openfiles);
			data.push('ANALYZATOR: ' + (app.analyzatoroutput || 'none'));

			var message = item.message.format(app.url) + ' (' + data.join(', ') + ')';

			LOGGER('alarms', item.name, message);
			EMIT('superadmin_app_alarm', app, item, message);

			if (app.stats)
				app.stats.alarms++;
			else
				app.stats.alarms = 1;

			SuperAdmin.send_notify('warning', message);
			NOSQL('alarms').modify({ '+notified': 1, dtnotified: NOW }).id(item.id);
			item.phone && SuperAdmin.send_sms(item.phone, message.removeTags());
			item.email && SuperAdmin.send_email(item.email, message, item.name);
		}

		next();

	}, callback);
};

SuperAdmin.notify_system = function() {

	if (!MAIN.sysrules || !MAIN.sysrules.length)
		return;

	var skip = {};

	MAIN.sysrules.wait(function(item, next) {

		var key = 'delay' + item.id;

		if (skip[key] || item[key] > NOW) {
			next();
			return;
		}

		if (item.validate(SuperAdmin.server)) {

			skip[key] = true;
			item[key] = NOW.add(item.delay);

			var data = [];

			data.push('CPU: ' + SuperAdmin.server.cpu + '%');
			data.push('RAM: ' + SuperAdmin.server.memused.filesize());
			data.push('HDD: ' + SuperAdmin.server.hddused.filesize());

			var message = item.message + ' (' + data.join(', ') + ')';

			LOGGER('alarms', item.name, message);
			EMIT('superadmin_system_alarm', SuperAdmin.server, item, message);

			SuperAdmin.send_notify('warning', message);
			NOSQL('alarms').modify({ '+notified': 1, dtnotified: NOW }).id(item.id);
			item.phone && SuperAdmin.send_sms(item.phone, message.removeTags());
			item.email && SuperAdmin.send_email(item.email, message, item.name);
		}

		next();

	});
};

SuperAdmin.send_sms = function(numbers, message) {

	if (!CONF.totalapi || !CONF.sms_from)
		return false;

	numbers.wait(function(item, next) {
		TotalAPI('sms', { from: CONF.sms_from, to: item, body: message }, next);
	});

	return true;
};

SuperAdmin.send_email = function(addresses, message, name) {
	var message = LOGMAIL(addresses[0], name, message);
	for (var i = 1; i < addresses.length; i++)
		message.to(addresses[i]);
};

SuperAdmin.send_notify = function(type, body) {
	PREF.set('notifications', (PREF.notifications || 0) + 1);
	NOSQL('notifications').insert({ type: type, body: body, dtcreated: NOW });
};

SuperAdmin.init();

Spawn('mpstat', ['-P', 'ALL', '10']).stdout.on('data', function(response) {

	response.toString('utf8').parseTerminal(function(arr) {
		if (arr[2] === 'all')
			SuperAdmin.server.cpu = +arr[3];
		else
			SuperAdmin.server.cpucores[+arr[2]] = +arr[3];
	}, 1);

});