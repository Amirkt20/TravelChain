import { deploy } from "./deploy.js";

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
