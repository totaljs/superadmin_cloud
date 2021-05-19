exports.install = function() {
	ROUTE('+GET /*', 'index');
	ROUTE('+GET /logoff', redirect_logoff);
	ROUTE('-GET /*', 'login');
	ROUTE('-GET /', welcome);
};

function welcome() {
	var self = this;
	var opt = {};
	opt.url = 'https://www.totaljs.com/platform/welcome/cloud';
	opt.callback = function(err, response) {
		var html = response.body;
		html = html.replace(/(href|src)=".*?"/g, function(text) {
			var ishref = text.charAt(0) === 'h';
			text = text.substring(ishref ? 6 : 5, text.length - 1);
			return (ishref ? 'href' : 'src') + '="' + (text.charAt(1) === '/' || text.charAt(0) !== '/' ? text : ('https://www.totaljs.com' + text)) + '"';
		});
		self.html(html);
	};
	REQUEST(opt);
}

function redirect_logoff() {
	var self = this;
	SuperAdmin.logger('logoff', self);
	self.cookie('__sa', '', '-1 day');
	self.redirect('/');
}