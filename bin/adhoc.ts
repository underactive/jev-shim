#!/usr/bin/env node

import { startServer } from "../src/server.ts";

interface CliOptions {
	host: string;
	port: number;
	debug: boolean;
	apiKey?: string;
	help: boolean;
}

function usage(): string {
	return [
		"Usage: jev-shim-adhoc [options]",
		"",
		"Options:",
		"  --host <host>       Bind host (default: 127.0.0.1)",
		"  --port <port>       Bind port (default: 4179; 0 selects a free port)",
		"  --api-key <key>     TypeSafe API key (defaults to TYPESAFE_API_KEY)",
		"  --debug             Include request bodies and outputs in logs",
		"  --help              Show this help",
	].join("\n");
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = { host: "127.0.0.1", port: 4179, debug: false, help: false };
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--debug") {
			options.debug = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			options.help = true;
			continue;
		}
		if (argument === "--host" || argument === "--port" || argument === "--api-key") {
			const value = args[index + 1];
			if (value === undefined) throw new Error(`${argument} requires a value.`);
			index += 1;
			if (argument === "--host") options.host = value;
			if (argument === "--api-key") options.apiKey = value;
			if (argument === "--port") {
				const port = Number(value);
				if (!Number.isInteger(port) || port < 0 || port > 65_535) {
					throw new Error("--port must be an integer between 0 and 65535.");
				}
				options.port = port;
			}
			continue;
		}
		throw new Error(`Unknown option: ${argument}`);
	}
	return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
	console.log(usage());
} else {
	const started = await startServer([], {
		host: options.host,
		port: options.port,
		adhoc: true,
		debug: options.debug || process.env.PI_JEV_DEBUG === "1",
		jev: options.apiKey === undefined ? undefined : { apiKey: options.apiKey },
	});
	console.error(`jev-shim ad-hoc facade listening on ${started.url}`);
	const close = () => {
		void started.close().then(() => process.exit(0));
	};
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
}
