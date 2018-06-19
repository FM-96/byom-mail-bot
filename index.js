const cheerio = require('cheerio');
const Discord = require('discord.js');
const he = require('he');
const later = require('later');
const snekfetch = require('snekfetch');
const TurndownService = require('turndown');

const token = require('./auth.json').token;
const version = require('./package.json').version;

const turndownService = new TurndownService({
	hr: '- - -',
	codeBlockStyle: 'fenced',
	fence: '```',
});
turndownService.addRule('no-img', {
	filter: 'img',
	replacement: () => '',
});
turndownService.addRule('underline', {
	filter: 'u',
	replacement: (content) => `__${content}__`,
});

const client = new Discord.Client();

client.on('message', async message => {
	if (message.channel.type !== 'text') {
		return;
	}
	const me = await message.guild.fetchMember(client.user);

	if (message.content.startsWith(me + ' create')) {
		try {
			const email = message.content.slice((me + ' create').length);
			const response = await snekfetch.get(`https://api.byom.de/mail/secure_address?email=${email}`);
			const securemail = response.body.securemail;

			const mailCategory = message.guild.channels.find(e => e.type === 'category' && e.name.toLowerCase() === 'mail');
			if (!mailCategory) {
				return;
			}

			const newChannel = await message.guild.createChannel(email);
			newChannel.setParent(mailCategory);
			newChannel.setTopic(`${securemail}@byom.de`);

			await message.channel.send(`Created channel ${newChannel}`);
		} catch (err) {
			console.error(err);
		}
	}
});

client.login(token);

const oneMinuteSchedule = later.parse.recur().every().minute();
later.setInterval(async () => {
	for (const guild of client.guilds.array()) {
		try {
			const mailCategory = guild.channels.find(e => e.type === 'category' && e.name.toLowerCase() === 'mail');

			if (!mailCategory) {
				continue;
			}

			for (const mailChannel of client.channels.filterArray(e => e.parentID === mailCategory.id && e.type === 'text')) { // client.channels must be used due to https://github.com/discordjs/discord.js/issues/2400
				console.log(`${guild.name}#${mailChannel.name}`);
				// make requests to get mails and latest message in channel
				Promise.all([snekfetch.get(`https://api.byom.de/mails/${mailChannel.name}`), mailChannel.fetchMessages({limit: 1})]).then(async results => {
					let mails = JSON.parse(JSON.stringify(results[0].body));
					// sort results by timestamp
					mails.sort((a, b) => {
						if (a.created_at < b.created_at) {
							return -1;
						}
						if (a.created_at > b.created_at) {
							return 1;
						}
						return 0;
					});
					// compare results to latest message in channel
					const latestMessage = results[1].first();
					const latestMailId = latestMessage ? latestMessage.content.split('\n')[0] : null;
					const latestMailIndex = mails.findIndex(e => e.id === latestMailId);
					if (latestMailIndex !== -1) {
						mails = mails.slice(latestMailIndex + 1);
					}
					// post all newer mails to channel
					for (const mail of mails) {
						await mailChannel.send(...formatMail(mail)).catch(err => {
							console.error(err);
							return mailChannel.send(
								`${mail.id}\n**__ERROR__**\n${err.message}\nMail Body Length: ${mail.text.length}`,
								{
									embed: {
										title: 'Error',
										color: 0xff0000,
										timestamp: new Date(mail.created_at * 1000).toISOString(),
									},
									files: [{
										attachment: Buffer.from(JSON.stringify(mail, null, '\t')),
										name: `${mail.id}_debug.json`,
									}],
								}
							);
						});
					}
				}).catch(console.error);
			}
		} catch (err) {
			console.error(err);
		}
	}
}, oneMinuteSchedule);

function formatMail(mail) {
	const MESSAGE_LENGTH_LIMIT = 1800;
	const mailInfo = `${mail.id}\n**To:** ${he.decode(mail.to)}\n**From:** ${he.decode(mail.from)}\n**Subject:** ${he.decode(mail.subject)}`;

	let mailBody = '';
	let title;
	const files = [];

	if (mail.has_html) {
		const $ = cheerio.load(mail.html);

		const $title = $('title');
		if ($title.length && $title.text()) {
			title = $title.text();
			$title.remove();
		}
		const $p = $('body > p:first-child');
		if ($p.length) {
			// TODO check if the content is actually CSS
			$p.remove();
		}

		const mailHtmlBody = turndownService.turndown($.html()).replace(/\r\n/g, '\n').replace(/[ \u00a0]+\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/\n{2,}/g, '\n\n').replace(/\[\]\((.+?)\)/g, '[<textless link>]($1)');
		if (mailHtmlBody !== '-') {
			mailBody = mailHtmlBody;
			files.push({
				attachment: Buffer.from(mail.html),
				name: `${mail.id}_full.html`,
			});
			files.push({
				attachment: Buffer.from(mailHtmlBody),
				name: `${mail.id}_full.md`,
			});
		}
	}

	if (mail.text && mail.text !== '-') {
		const mailTextBody = he.decode(mail.text).replace(/\r\n/g, '\n').replace(/[ \u00a0]+\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/\n{2,}/g, '\n\n');
		mailBody = mailBody || mailTextBody;
		files.push({
			attachment: Buffer.from(mailTextBody),
			name: `${mail.id}_full.txt`,
		});
	}

	if (mailBody.length > MESSAGE_LENGTH_LIMIT) {
		mailBody = mailBody.slice(0, MESSAGE_LENGTH_LIMIT - 1) + '…';
	} else if (!mailBody) {
		mailBody = '-';
	}

	return [
		`${mailInfo}`,
		{
			embed: {
				title,
				description: mailBody,
				timestamp: new Date(mail.created_at * 1000).toISOString(),
				footer: {
					text: `${client.user.username} v${version}`,
				},
			},
			files,
		},
	];
}
