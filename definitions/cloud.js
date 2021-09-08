const Fs = require('fs');

function initcloud() {
	Fs.readFile('/usr/share/totaljs_cloud/config.json', function(err, buffer) {

		if (err) {
			setTimeout(initcloud, 1000);
			return;
		}

		PAUSESERVER('cloud');
		SuperAdmin.cloud = buffer.toString('utf8').parseJSON(true);
		SuperAdmin.cloud.domain = SuperAdmin.cloud.url.substring(0, 8) + '@' + SuperAdmin.cloud.id + '.' + SuperAdmin.cloud.url.substring(8);

		if (!PREF.initialized) {
			SuperAdmin.cloud.apps && setTimeout(() => SuperAdmin.cloud.apps.wait((item, next) => FUNC.cloud_app(item, next)), 1000);
			PREF.set('initialized', true);
		}

	});
}

PAUSESERVER('cloud');
ON('ready', initcloud);

FUNC.cloud_app = function(name, callback) {

	var data = {};
	data.url = SuperAdmin.cloud.domain.replace('@', name);
	data.ddos = 50;
	data.proxytimeout = 600;
	data.size = 10;
	data.version = name === 'flow' ? 'total3' : 'total4';
	data.watcher = false;
	data.debug = false;

	EXEC('+Apps --> check port save (response)', data, function(err, response) {
		if (err) {
			callback(err, response);
		} else {
			var data = {};
			data.template = 'https://raw.githubusercontent.com/totaljs/superadmin_templates/main/{0}.zip'.format(name);
			data.remove = false;
			data.npm = false;
			data.backup = false;
			setTimeout(function() {
				EXEC('+Templates --> check stop backup remove unpack (response) restart', data, callback).id = response.value;
			}, 3000);
		}
	});
};

FUNC.cloud_remove = function(app, callback) {
	var data = {};
	data.port = app.port;
	data.url = app.url;
	data.token = SuperAdmin.cloud.token;
	RESTBuilder.DELETE(SuperAdmin.cloud.url + '/api/application/', data).exec(callback);
};

FUNC.cloud_create = function(app, callback) {

	if (app.servicemode) {
		callback();
		return;
	}

	var data = {};
	data.port = app.port;
	data.ddos = app.ddos;
	data.uploadsize = app.uploadsize;
	data.proxytimeout = app.proxytimeout;
	data.url = app.url;
	data.redirect = app.redirect;
	data.token = SuperAdmin.cloud.token;
	RESTBuilder.POST(SuperAdmin.cloud.url + '/api/application/', data).timeout(60000).exec(callback);
};

