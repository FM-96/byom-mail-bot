const Discord = require('discord.js');
const later = require('later');
const snekfetch = require('snekfetch');

const token = require('./auth.json').token;

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
				Promise.all([snekfetch.get(`https://api.byom.de/mails/${mailChannel.name}`), mailChannel.fetchMessages({limit: 1})]).then(results => {
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
						mailChannel.send(formatMail(mail)).catch(console.error);
					}
				}).catch(console.error);
			}
		} catch (err) {
			console.error(err);
		}
	}
}, oneMinuteSchedule);

function formatMail(mail) {
	// TODO
	return `${mail.id}\n${mail.subject}`;
}
