const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");

const get_env_secrets = async (type, name, EnvName, GHToken) => {
  const secret_response = await fetch(
    `https://api.github.com/repositories/${github.repo_id}/environments/${EnvName}/${type}/${name}`,
    (Headers = {
      Authorization: `Bearer ${GHToken}`,
    })
  );
  if (secret_response.status !== 200) {
    console.error(
      `Failed to fetch ${type}.${name} from ${EnvName}: ${secret_response.status}`
    );
    return false;
  }
  return true;
};

const get_repo_and_org_secrets = async (type, name, GHToken) => {
  const repo_secrets_response = await fetch(
    `https://api.github.com/repositories/${github.repo_id}/actions/secrets/${name}`,
    (Headers = {
      Authorization: `Bearer ${GHToken}`,
    })
  );
  if (repo_secrets_response.status !== 200) {
    console.error(
      `Failed to fetch ${type}.${name} from repository: ${repo_secrets_response.status}`
    );

    const org_secrets_response = await fetch(
      `https://api.github.com/orgs/${github.org}/actions/secrets/${name}`,
      (Headers = {
        Authorization: `Bearer ${GHToken}`,
      })
    );
    if (org_secrets_response.status !== 200) {
      console.error(
        `Failed to fetch ${type}.${name} from organization: ${org_secrets_response.status}`
      );
      return false;
    }
  }
  return true;
};

try {
  // INPUT
  const files = core.getMultilineInput("files");
  const EnvName = core.getInput("env_name");
  const GHToken = core.getInput("gh_token");

  let missing = [];

  console.log(files);
  // Ensure that the files are not empty
  if (files.length === 0) {
    throw new Error("No files were provided");
  }

  // Ensure that GH Token is not empty
  if (GHToken === "") {
    throw new Error("No GitHub Token was provided");
  }

  let target;
  console.log(EnvName);
  // If the environment name is not provided, use repository target
  if (EnvName === "") {
    target = "repository";
  } else {
    target = EnvName;
  }

  const folderPath = path.join(__dirname, ".github", "workflows");
  files.forEach((fileName) => {
    const filePath = path.join(folderPath, fileName);
    try {
      const fileContents = fs.readFileSync(filePath, "utf8");
      console.log(`Content of ${fileName}:`);
      const matches = fileContents.match(
        /(\${{\s*(secrets|vars)\.[^\s]*\s*}})/g
      );
      if (matches) {
        matches.forEach((match) => {
          console.log(match);
          // Match = ${{ secrets.GITHUB_TOKEN }} or ${{ vars.GITHUB_TEST }}, get the secrets. or vars. part
          const type = match.split(".")[0].split(" ")[1];
          if (type === "secrets") {
            console.log("Secrets");
            console.log(github.context.payload.repository.id);
          } else if (type === "vars") {
            console.log("Vars");
          } else {
            console.warn(`Unknown type \$\{\{ \}\}: ${type}`);
            return;
          }

          // ${{ secrets.GITHUB_TOKEN }}
          const name = match.split(".")[1].split(" ")[0];
          if (name === "GITHUB_TOKEN") {
            console.debug("Skipping GITHUB_TOKEN");
            return;
          }
          if (target !== "repository") {
            console.log("Environment Name: " + EnvName);
            get_env_secrets(type, name, EnvName, GHToken).then((response) => {
              if (!response) {
                get_repo_and_org_secrets(type, name, GHToken).then(
                  (deep_response) => {
                    if (!deep_response) {
                      missing.push({
                        type: type,
                        name: name,
                        fileName: fileName,
                      });
                    }
                  }
                );
              }
            });
          } else {
            get_repo_and_org_secrets(
              type,
              name,
              GHToken
            ).then((response) => {
              if (!response) {
                missing.push({
                  type: type,
                  name: name,
                  fileName: fileName,
                });
              }
            });
          }
        });
      }
    } catch (error) {
      console.error(`Error reading ${fileName}: ${error}`);
    }
  });

  const time = new Date().toTimeString();
  core.setOutput("time", time);
  core.setOutput("missing", missing);
  // Get the JSON webhook payload for the event that triggered the workflow
  const payload = JSON.stringify(github.context.payload, undefined, 2);
  console.log(`The event payload: ${payload}`);
} catch (error) {
  core.setFailed(error.message);
}
