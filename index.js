const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

const GetRequestInit = (GHToken) => {
  const headers = new Headers();
  headers.append('accept', 'application/vnd.github+json');
  headers.append('Authorization', `Bearer ${GHToken}`);
  headers.append('X-GitHub-Api-Version', '2022-11-28');

  return {
    headers,
  };
};

const log = (message, verbose) => {
  if (verbose) {
    console.log(message); // eslint-disable-line no-console
  }
};

const error = (message, verbose) => {
  if (verbose) {
    console.error(message); // eslint-disable-line no-console
  }
};

const GetEnvSecrets = async (type, name, EnvName, GHToken, verbose) => {
  log(
    `Calling: https://api.github.com/repositories/${github.context.payload.repository.id}/environments/${EnvName}/${type}/${name}`,
    verbose,
  );
  const secretResponse = await fetch(
    `https://api.github.com/repositories/${github.context.payload.repository.id}/environments/${EnvName}/${type}/${name}`,
    GetRequestInit(GHToken),
  );
  if (secretResponse.status !== 200) {
    error(
      `Failed to fetch ${type}.${name} from ${EnvName}: ${secretResponse.status}`,
      verbose,
    );
    return false;
  }
  return true;
};

const GetRepoAndOrgSecrets = async (type, name, checkOrg, GHToken, verbose) => {
  log(
    `Calling: https://api.github.com/repositories/${github.context.payload.repository.id}/actions/${type}/${name}`,
    verbose,
  );
  return fetch(
    `https://api.github.com/repositories/${github.context.payload.repository.id}/actions/${type}/${name}`,
    GetRequestInit(GHToken),
  ).then(async (response) => {
    if (response.status !== 200) {
      error(
        `Failed to fetch ${type}.${name} from repository: ${response.status}`,
        verbose,
      );
      if (checkOrg) {
        log(
          `Calling: https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/${type}/${name}`,
          verbose,
        );
        await fetch(
          `https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/${type}/${name}`,
          GetRequestInit(GHToken),
        ).then((orgResponse) => {
          if (orgResponse.status !== 200) {
            error(
              `Failed to fetch ${type}.${name} from organization: ${orgResponse.status}`,
              verbose,
            );
            return false;
          }
          return true;
        });
      } else {
        return false;
      }
    }
    return true;
  });
};

const GetRepoAndOrgVars = async (type, name, checkOrg, GHToken, verbose) => {
  log(
    `Calling: https://api.github.com/repos/${github.context.payload.repository.owner.name}/${github.context.payload.repository.name}/actions/variables/${name}`,
    verbose,
  );
  await fetch(
    `https://api.github.com/repos/${github.context.payload.repository.owner.name}/${github.context.payload.repository.name}/actions/variables/${name}`,
    GetRequestInit(GHToken),
  ).then(async (response) => {
    if (response.status !== 200) {
      error(
        `Failed to fetch ${type}.${name} from repository: ${response.status}`,
        verbose,
      );
      if (checkOrg) {
        log(
          `Calling: https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/variables/${name}`,
          verbose,
        );
        await fetch(
          `https://api.github.com/orgs/${github.context.payload.repository.owner.name}/actions/variables/${name}`,
          GetRequestInit(GHToken),
        ).then((orgResponse) => {
          if (orgResponse.status !== 200) {
            error(
              `Failed to fetch ${type}.${name} from organization: ${orgResponse.status}`,
              verbose,
            );
            return false;
          }
          return true;
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
  const files = core.getMultilineInput('files');
  const EnvName = core.getInput('env_name');
  const GHToken = core.getInput('gh_token');
  const CheckOrg = core.getBooleanInput('checkOrg');
  const verbose = core.getBooleanInput('verbose');

  const missing = [];

  log(files, verbose);
  // Ensure that the files are not empty
  if (files.length === 0) {
    throw new Error('No files were provided');
  }

  // Ensure that GH Token is not empty
  if (GHToken === '') {
    throw new Error('No GitHub Token was provided');
  }

  let target;
  log(EnvName, verbose);
  // If the environment name is not provided, use repository target
  if (EnvName === '') {
    target = 'repository';
  } else {
    target = EnvName;
  }

  const folderPath = path.join(__dirname, '.github', 'workflows');
  const promises = files.map((fileName) => {
    const filePath = path.join(folderPath, fileName);
    try {
      const fileContents = fs.readFileSync(filePath, 'utf8');
      log(`Content of ${fileName}:`, verbose);
      const matches = fileContents.match(
        /(\${{\s*(secrets|vars)\.[^\s]*\s*}})/g,
      );
      if (matches) {
        return Promise.all(matches.map((match) => {
          log(match, verbose);
          // Match = ${{ secrets.GITHUB_TOKEN }} or
          // ${{ vars.GITHUB_TEST }}, get the secrets. or vars. part
          const type = match.split('.')[0].split(' ')[1];
          if (type === 'secrets') {
            log('Secrets', verbose);
            log(github.context.payload.repository.id, verbose);
          } else if (type === 'vars') {
            log('Vars', verbose);
          } else {
            error(`Unknown type $\{{ }}: ${type}`, verbose);
            return Promise.resolve();
          }

          // ${{ secrets.GITHUB_TOKEN }}
          const name = match.split('.')[1].split(' ')[0];
          if (name === 'GITHUB_TOKEN') {
            log('Skipping GITHUB_TOKEN');
            return Promise.resolve();
          }
          if (target !== 'repository') {
            log(`Environment Name: ${EnvName}`, verbose);
            return GetEnvSecrets(type, name, EnvName, GHToken).then((response) => {
              if (!response) {
                return GetRepoAndOrgSecrets(type, name, CheckOrg, GHToken, verbose).then(
                  (deepResponse) => {
                    if (!deepResponse) {
                      log(`Adding ${type}.${name} to missing`, true);
                      missing.push({
                        type,
                        name,
                        fileName,
                      });
                    }
                  },
                );
              }
              return Promise.resolve();
            });
          }
          if (type === 'vars') {
            return GetRepoAndOrgVars(type, name, CheckOrg, GHToken, verbose).then(
              (response) => {
                if (!response) {
                  log(`Adding ${type}.${name} to missing`, true);
                  missing.push({
                    type,
                    name,
                    fileName,
                  });
                }
              },
            );
          }
          return GetRepoAndOrgSecrets(type, name, CheckOrg, GHToken, verbose).then(
            (response) => {
              if (!response) {
                log(`Adding ${type}.${name} to missing`, true);
                missing.push({
                  type,
                  name,
                  fileName,
                });
              }
            },
          );
        }));
      }
    } catch (err) {
      error(`Error reading ${fileName}: ${err}`, true);
      return Promise.reject(err);
    }

    return Promise.resolve();
  });

  Promise.all(promises).then(() => {
    log('Missing secrets/variables:', verbose);
    log(missing, verbose);

    if (missing.length > 0) {
      core.setFailed('Missing secrets/variables');
    }

    const payload = JSON.stringify(github.context.payload, undefined, 2);
    log(`The event payload: ${payload}`, verbose);
  }).catch((err) => {
    core.setFailed(err.message);
  });
} catch (err) {
  core.setFailed(err.message);
}
