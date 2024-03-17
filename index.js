const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");

const get_request_init = (GHToken) => {
  headers = new Headers();
  headers.append("accept", "application/vnd.github+json");
  headers.append("Authorization", `Bearer ${GHToken}`);
  headers.append("X-GitHub-Api-Version", "2022-11-28");

  return {
    headers: headers,
  };
};

const get_env_secrets = async (type, name, EnvName, GHToken) => {
  console.log(
    `Calling: https://api.github.com/repositories/${github.context.payload.repository.id}/environments/${EnvName}/${type}/${name}`,
  );
  const secret_response = await fetch(
    `https://api.github.com/repositories/${github.context.payload.repository.id}/environments/${EnvName}/${type}/${name}`,
    get_request_init(GHToken),
  );
  if (secret_response.status !== 200) {
    console.error(
      `Failed to fetch ${type}.${name} from ${EnvName}: ${secret_response.status}`,
    );
    return false;
  }
  return true;
};

const get_repo_and_org_secrets = async (type, name, check_org, GHToken) => {
  console.log(
    `Calling: https://api.github.com/repositories/${github.context.payload.repository.id}/actions/${type}/${name}`,
  );
  return await fetch(
    `https://api.github.com/repositories/${github.context.payload.repository.id}/actions/${type}/${name}`,
    get_request_init(GHToken),
  ).then(async (response) => {
    if (response.status !== 200) {
      console.error(
        `Failed to fetch ${type}.${name} from repository: ${response.status}`,
      );
      if (check_org) {
        console.log(
          `Calling: https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/${type}/${name}`,
        );
        await fetch(
          `https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/${type}/${name}`,
          get_request_init(GHToken),
        ).then((response) => {
          if (response.status !== 200) {
            console.error(
              `Failed to fetch ${type}.${name} from organization: ${response.status}`,
            );
            return false;
          }
        });
      } else {
        return false;
      }
    }
    return true;
  });
};

const get_repo_and_org_vars = async (type, name, check_org, GHToken) => {
  console.log(
    `Calling: https://api.github.com/repos/${github.context.payload.repository.owner.name}/${github.context.payload.repository.name}/actions/variables/${name}`,
  );
  await fetch(
    `https://api.github.com/repos/${github.context.payload.repository.owner.name}/${github.context.payload.repository.name}/actions/variables/${name}`,
    get_request_init(GHToken),
  ).then(async (response) => {
    if (response.status !== 200) {
      console.error(
        `Failed to fetch ${type}.${name} from repository: ${response.status}`,
      );
      if (check_org) {
        console.log(
          `Calling: https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/variables/${name}`,
        );
        await fetch(
          `https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/variables/${name}`,
          get_request_init(GHToken),
        ).then((response) => {
          if (response.status !== 200) {
            console.error(
              `Failed to fetch ${type}.${name} from organization: ${response.status}`,
            );
            return false;
          }
        });
      } else {
        return false;
      }
    }
    return true;
  });
};

try {
  // INPUT
  const files = core.getMultilineInput("files");
  const EnvName = core.getInput("env_name");
  const GHToken = core.getInput("gh_token");
  const CheckOrg = core.getBooleanInput("check_org");

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
  const promises = files.map((fileName) => {
    const filePath = path.join(folderPath, fileName);
    try {
      const fileContents = fs.readFileSync(filePath, "utf8");
      console.log(`Content of ${fileName}:`);
      const matches = fileContents.match(
        /(\${{\s*(secrets|vars)\.[^\s]*\s*}})/g,
      );
      if (matches) {
        return Promise.all(matches.map((match) => {
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
            return Promise.resolve();
          }

          // ${{ secrets.GITHUB_TOKEN }}
          const name = match.split(".")[1].split(" ")[0];
          if (name === "GITHUB_TOKEN") {
            console.debug("Skipping GITHUB_TOKEN");
            return Promise.resolve();
          }
          if (target !== "repository") {
            console.log("Environment Name: " + EnvName);
            return get_env_secrets(type, name, EnvName, GHToken).then((response) => {
              if (!response) {
                return get_repo_and_org_secrets(type, name, CheckOrg, GHToken).then(
                  (deep_response) => {
                    if (!deep_response) {
                      console.log(`Adding ${type}.${name} to missing`);
                      missing.push({
                        type: type,
                        name: name,
                        fileName: fileName,
                      });
                    }
                  },
                );
              }
            });
          } else {
            if (type === "vars") {
              return get_repo_and_org_vars(type, name, CheckOrg, GHToken).then(
                (response) => {
                  if (!response) {
                    console.log(`Adding ${type}.${name} to missing`);
                    missing.push({
                      type: type,
                      name: name,
                      fileName: fileName,
                    });
                  }
                },
              );
            } else {
              return get_repo_and_org_secrets(type, name, CheckOrg, GHToken).then(
                (response) => {
                  if (!response) {
                    console.log(`Adding ${type}.${name} to missing`);
                    missing.push({
                      type: type,
                      name: name,
                      fileName: fileName,
                    });
                  }
                },
              );
            }
          }
        }));
      }
    } catch (error) {
      console.error(`Error reading ${fileName}: ${error}`);
      return Promise.resolve();
    }
  });

  Promise.all(promises).then(() => {
    console.log("Missing secrets/variables:")
    console.log(missing)
    const time = new Date().toTimeString();
    core.setOutput("time", time);
    core.setOutput("missing", missing);
    // Get the JSON webhook payload for the event that triggered the workflow
    const payload = JSON.stringify(github.context.payload, undefined, 2);
    console.log(`The event payload: ${payload}`);
  }).catch((error) => {
    core.setFailed(error.message);
  });
} catch (error) {
  core.setFailed(error.message);
}
