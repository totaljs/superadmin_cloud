const Fs = require('fs');

ON('ready', function() {
	Fs.readFile('/usr/share/totaljs_cloud/config.json', function(err, buffer) {
		SuperAdmin.cloud = buffer.toString('utf8').parseJSON(true);
		SuperAdmin.cloud.domain = SuperAdmin.cloud.url.substring(0, 8) + '@' + SuperAdmin.cloud.id + '.' + SuperAdmin.cloud.url.substring(8);
	});
});

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
	RESTBuilder.POST(SuperAdmin.cloud.url + '/api/application/', data).exec(callback);
};

