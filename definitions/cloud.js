const Fs = require('fs');

ON('ready', function() {
	Fs.readFile('/usr/share/totaljs_cloud/config.json', function(err, buffer) {

		SuperAdmin.cloud = buffer.toString('utf8').parseJSON(true);
		SuperAdmin.cloud.domain = SuperAdmin.cloud.url.substring(0, 8) + '@' + SuperAdmin.cloud.id + '.' + SuperAdmin.cloud.url.substring(8);

		if (!PREF.initialized) {
			SuperAdmin.cloud.apps && setTimeout(() => SuperAdmin.cloud.apps.wait((item, next) => FUNC.cloud_app(item, next)), 1000);
			PREF.set('initialized', true);
		}

	});
});

/*
{
	userid: '510534001ft1a',
	id: 'c6e421001ou51c',
	ip: '10.10.10.25',
	token: 'nv218u18ohbq8fcjys1n5v1eei65k1',
	url: 'https://cloudtest.totaljs.cloud',
	dnstoken: '14u5qkm11xtt8zdxfypt14uyek01dm1dsc5'
	dns: token, prefix
	apps: ['cms', 'flow']
}
*/

FUNC.cloud_app = function(name, callback) {

	var data = {};
	data.url = SuperAdmin.cloud.domain.replace('@', name);
	data.ddos = 50;
	data.proxytimeout = 600;
	data.size = 10;
	data.version = 'total4';
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

FUNC.cloud_remove = function(port, callback) {
	var data = {};
	data.port = port;
	data.token = SuperAdmin.cloud.token;
	RESTBuilder.DELETE(SuperAdmin.cloud.url + '/api/application/', data).exec(callback);
};

FUNC.cloud_create = function(app, callback) {
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

