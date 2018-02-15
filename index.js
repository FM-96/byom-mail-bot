const Discord = require('discord.js');

const token = require('./auth.json').token;

const client = new Discord.Client();

client.login(token);
