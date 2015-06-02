(function () {
  'use strict';

  var colors         = require('colors');
  var strip          = require('cli-color/strip');
  var fs             = require('fs');
  var prompt         = require('prompt-sync');
  var child_process  = require('child_process');
  var pkg            = require('./package.json');
  var oldVersion     = pkg.version;
  var abortCmds      = [ 'git checkout master', 'rm abort push' ];
  var pushCmds       = [ 'rm abort push'];
  var cleanupCmds    = [];
  var defaultOptions = { encoding: 'utf-8' };
  var origin         = 'https://github.com/angular/material.git';
  var lineWidth      = 65;
  var newVersion;

  if (validate()) {
    newVersion = getNewVersion();

    line();

    checkoutVersionBranch();
    updateVersion();
    createChangelog();
    commitChanges();
    tagRelease();
    cloneRepo('bower-material');
    updateBowerVersion();
    cloneRepo('code.material.angularjs.org');
    updateSite();
    updateMaster();
    writeScript('abort', abortCmds.concat(cleanupCmds));
    writeScript('push', pushCmds.concat(cleanupCmds));

    line();
    log('Your repo is ready to be pushed.');
    log('Please look over {{"CHANGELOG.md".cyan}} and make any changes.');
    log('When you are ready, please run "{{"./push".cyan}}" to finish the process.');
    log('If you would like to cancel this release, please run "./abort"');
  }

  //-- utility methods

  function validate () {
    if (exec('npm whoami') !== 'angularcore') {
      err('You must be authenticated with npm as "angularcore" to perform a release.');
    } else if (exec('git rev-parse --abbrev-ref HEAD') !== 'master') {
      err('Releases can only performed from master at this time.');
    } else if (exec('git pull -q --rebase {{origin}} master 2> /dev/null') instanceof Error) {
      err('Please make sure your local branch is synced with origin/master.');
    } else {
      return true;
    }
    function err (msg) {
      var str = 'Error: ' + msg;
      log(str.red);
    }
  }

  function checkoutVersionBranch () {
    exec('git checkout -q -b release/{{newVersion}}');
    abortCmds.push('git branch -D release/{{newVersion}}');
  }

  function updateVersion () {
    start('Updating {{"package.json".cyan}} version from {{oldVersion.cyan}} to {{newVersion.cyan}}...');
    pkg.version = newVersion;
    fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
    done();
    abortCmds.push('git checkout package.json');
    pushCmds.push('git add package.json');
  }

  function createChangelog () {
    start('Generating changelog from {{oldVersion.cyan}} to {{newVersion.cyan}}...');
    exec([
      'git fetch --tags',
      'gulp changelog --sha=$(git merge-base v{{oldVersion}} HEAD)'
    ]);
    done();
    abortCmds.push('git checkout CHANGELOG.md');
    pushCmds.push('git add CHANGELOG.md');
  }

  function clear () {
    write("\u001b[2J\u001b[0;0H");
  }

  function getNewVersion () {
    clear();
    var options = getVersionOptions(oldVersion), key, type, version;
    log('The current version is {{oldVersion.cyan}}.');
    log('');
    log('What type of release is this?');
    for (key in options) { log((+key + 1) + ') ' + options[key].cyan); }
    log('');
    write('Please select a new version: ');
    type = prompt();

    if (options[type - 1]) version = options[type - 1];
    else if (type.match(/^\d+\.\d+\.\d+(-rc\d+)?$/)) version = type;
    else throw new Error('Your entry was invalid.');

    if (version.indexOf('rc') < 0) {
      log('');
      write('Is this a release candidate? {{"[yes/no]".cyan}} ');
      if (prompt() === 'yes') version += '-rc1';
    }

    log('');
    log('The new version will be ' + version.cyan + '.');
    write('Is this correct? {{"[yes/no]".cyan}} ');
    return prompt() === 'yes' ? version : getNewVersion();

    function getVersionOptions (version) {
      return version.match(/-rc\d+$/)
          ? [ increment(version, 'rc'),
              increment(version, 'minor') ]
          : [ increment(version, 'patch'),
              increment(version, 'minor'),
              increment(version, 'major') ];

      function increment (versionString, type) {
        var version = parseVersion(versionString);
        if (version.rc) {
          switch (type) {
            case 'minor': version.rc = 0; break;
            case 'rc': version.rc++; break;
          }
        } else {
          version[type]++;
          //-- reset any version numbers lower than the one changed
          switch (type) {
            case 'major': version.minor = 0;
            case 'minor': version.patch = 0;
            case 'patch': version.rc = 0;
          }
        }
        return getVersionString(version);

        function parseVersion (version) {
          var parts = version.split(/\.|\-rc/g);
          return { string: version, major: parts[0], minor: parts[1], patch: parts[2], rc: parts[3] || 0 };
        }

        function getVersionString(version) {
          var str = version.major + '.' + version.minor + '.' + version.patch;
          if (version.rc) str += '-rc' + version.rc;
          return str;
        }
      }
    }
  }

  function tagRelease () {
    pushCmds.push(
        'git tag v{{newVersion}}',
        'git push {{origin}} HEAD',
        'git push --tags'
    );
  }

  function commitChanges () {
    start('Committing changes...');
    exec('git commit -am "release: version {{newVersion}}"');
    done();
    pushCmds.push('git commit --amend --no-edit');
  }

  function cloneRepo (repo) {
    start('Cloning ' + repo.cyan + ' from Github...');
    exec('git clone https://github.com/angular/' + repo + '.git --depth=1 2> /dev/null');
    done();
    cleanupCmds.push('rm -rf ' + repo);
  }

  function fill(str) {
    return str.replace(/\{\{[^\}]+\}\}/g, function (match) {
      return eval(match.substr(2, match.length - 4));
    });
  }

  function writeScript (name, cmds) {
    fs.writeFileSync(name, '#!/usr/bin/env bash\n\n' + fill(cmds.join('\n')));
    exec('chmod +x ' + name);
  }

  function updateBowerVersion () {
    start('Updating bower version...');
    var options = { cwd: './bower-material' },
        bower = require(options.cwd + '/bower.json'),
        pkg = require(options.cwd + '/package.json');
    //-- update versions in config files
    bower.version = pkg.version = newVersion;
    fs.writeFileSync(options.cwd + '/package.json', JSON.stringify(pkg, null, 2));
    fs.writeFileSync(options.cwd + '/bower.json', JSON.stringify(bower, null, 2));
    done();
    start('Building bower files...');
    //-- build files for bower
    exec([
      'rm -rf dist',
      'gulp build',
      'gulp build-all-modules --mode=default',
      'gulp build-all-modules --mode=closure',
      'rm -rf dist/demos',
      'sed -i \'\' \'s/\\/rawgit\\.com\\/angular\\/bower-material\\/master\\/angular-material\\.js/\\/cdn.rawgit.com/angular/bower-material/v0.9.7/angular-material.js/\' dist/docs/docs.js'
    ]);
    done();
    start('Copy files into bower repo...');
    //-- copy files over to bower repo
    exec([
      'cp -Rf ../dist/* ./',
      'git add -A',
      'git commit -m "release: version {{newVersion}}"',
      'rm -rf ../dist'
    ], options);
    done();
    //-- add steps to push script
    pushCmds.push(
        comment('push to bower (master and tag) and publish to npm'),
        'cd ' + options.cwd,
        'cp ../CHANGELOG.md .',
        'git add CHANGELOG.md',
        'git commit --amend --no-edit',
        'git tag -f v{{newVersion}}',
        'git push',
        'git push --tags',
        'npm publish',
        'cd ..'
    );
  }

  function updateSite () {
    start('Adding new version of the docs site...');
    var options = { cwd: './code.material.angularjs.org' },
        config  = require(options.cwd + '/docs.json');
    config.versions.unshift(newVersion);
    config.latest = newVersion;
    fs.writeFileSync(options.cwd + '/docs.json', JSON.stringify(config, null, 2));
    //-- build files for bower
    exec([
      'rm -rf dist',
      'gulp docs'
    ]);
    //-- copy files over to site repo
    exec([
      'rm -rf latest',
      'cp -Rf ../dist/docs {{newVersion}}',
      'cp -Rf ../dist/docs latest',
      'git add -A',
      'git commit -m "release: version {{newVersion}}"',
      'rm -rf ../dist'
    ], options);
    done();
    //-- add steps to push script
    pushCmds.push(
        comment('push the site'),
        'cd ' + options.cwd,
        'git push',
        'cd ..'
    );
  }

  function updateMaster () {
    pushCmds.push(
        comment('update package.json in master'),
        'git co master',
        'git pull --rebase {{origin}} master',
        'git checkout release/{{newVersion}} -- CHANGELOG.md',
        'node -e "' + stringifyFunction(buildCommand) + '"',
        'git add CHANGELOG.md',
        'git add package.json',
        'git commit -m "update version number in package.json to {{newVersion}}"',
        'git push'
    );
    function buildCommand () {
      require('fs').writeFileSync('package.json', JSON.stringify(getUpdatedJson(), null, 2));
      function getUpdatedJson () {
        var json = require('./package.json');
        json.version = '{{newVersion}}';
        return json;
      }
    }
    function stringifyFunction (method) {
      return method
          .toString()
          .split('\n')
          .slice(1, -1)
          .map(function (line) { return line.trim(); })
          .join(' ')
          .replace(/"/g, '\\"');
    }
  }

  function done () {
    log('done'.green);
  }

  function exec (cmd, userOptions) {
    if (cmd instanceof Array) {
      return cmd.map(function (cmd) { return exec(cmd, userOptions); });
    }
    try {
      var options = Object.create(defaultOptions);
      for (var key in userOptions) options[key] = userOptions[key];
      return child_process.execSync(fill(cmd), options).trim();
    } catch (err) {
      return err;
    }
  }

  function comment (msg) {
    return '\n# ' + msg + '\n';
  }

  function start (msg) {
    var parsedMsg = fill(msg),
        msgLength = strip(parsedMsg).length,
        diff = lineWidth - 4 - msgLength;
    write(parsedMsg + Array(diff + 1).join(' '));
  }

  function log (msg) {
    console.log(fill(msg));
  }

  function write (msg) {
    process.stdout.write(fill(msg));
  }

  function line () {
    log(Array(lineWidth + 1).join('-'));
  }
})();
