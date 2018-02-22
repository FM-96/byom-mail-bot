const Discord = require('discord.js');
const he = require('he');
const later = require('later');
const snekfetch = require('snekfetch');

const token = require('./auth.json').token;
const version = require('./package.json').version;

const client = new Discord.Client();

client.login(token);

const oneMinuteSchedule = later.parse.recur().every().minute();
later.setInterval(async () => {
	for (const guild of client.guilds.array()) {
		try {
			const mailCategory = guild.channels.find(e => e.type !== 'text' && e.type !== 'voice' && e.name.toLowerCase() === 'mail');

			if (!mailCategory) {
				continue;
			}

			for (const mailChannel of mailCategory.children.array().filter(e => e.type === 'text')) {
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
	const mailBody = he.decode(mail.text).replace(/\r\n/g, '\n');

	let mailProcessedBody = mailBody;
	const files = [];
	if (mailBody.length > MESSAGE_LENGTH_LIMIT) {
		mailProcessedBody = mailBody.slice(0, MESSAGE_LENGTH_LIMIT - 1) + '…';
		files.push({
			attachment: Buffer.from(mailBody),
			name: `${mail.id}_full.txt`,
		});
	}

	if (mail.html) {
		files.push({
			attachment: Buffer.from(mail.html),
			name: `${mail.id}_full.html`,
		});
	}

	return [
		`${mailInfo}`,
		{
			embed: {
				description: mailProcessedBody,
				timestamp: new Date(mail.created_at * 1000).toISOString(),
				footer: {
					text: `${client.user.username} v${version}`,
				},
			},
			files,
		},
	];
}
