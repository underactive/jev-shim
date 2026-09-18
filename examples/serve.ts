import { startServer, taskAssessmentProfile } from "../index.ts";

const server = await startServer([taskAssessmentProfile], {
	port: 4179,
});

console.error(`Jev facade listening on ${server.url}`);
