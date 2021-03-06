/**
 * @copyright 2015, Andrey Popp <8mayday@gmail.com>
 */

import fs from 'fs';
import path from 'path';
import debug from 'debug';
import webpack from 'webpack';
import Promise from 'bluebird';
import findParentDir from 'find-parent-dir';
import escapeRegexp from 'escape-regexp';
import nodeCallbackAdapter from 'node-callback-adapter';
import {Minimatch} from 'minimatch';

let findParentDirPromise = Promise.promisify(findParentDir);
let readFilePromise = Promise.promisify(fs.readFile);

let log = debug('webpack-package-loaders-plugin');


function parsePackageData(src) {
  let data = JSON.parse(src);
  if (data.webpack && data.webpack.loaders) {
    data.webpack.loaders.forEach(loader => {
      if (typeof loader.loader === 'string') {
        loader.test = new Minimatch(loader.test);
      }
    });
  }
  return data;
}

export default class PackageLoadersPlugin {

  constructor(packageFilename = 'package.json') {
    this.packageFilename = packageFilename;
    this._packagesByDirectory = {};
    this._packageDirectoriesByDirectory = {};
  }

  apply(compiler) {
    compiler.plugin('normal-module-factory', factory =>
      factory.plugin('after-resolve', (data, callback) =>
        this.onAfterResolve(compiler, factory, data, callback)));
  }

  @nodeCallbackAdapter
  async onAfterResolve(compiler, factory, data) {
    log(`processing ${data.resource} resource`);
    let resolveLoader = Promise.promisify(compiler.resolvers.loader.resolve);
    let {packageData, packageDirname} = await this.findPackageForResource(data.resource);
    if (packageData && packageData.webpack && packageData.webpack.loaders) {
      let resourceRelative = path.relative(packageDirname, data.resource);
      let loaders = await Promise.all(packageData.webpack.loaders
        .filter(loader => loader.test.match(resourceRelative))
        .map(loader => resolveLoader(path.dirname(data.resource), loader.loader)));
      log(`adding ${loaders} loaders for ${resourceRelative} resource`);
      data = {...data, loaders: data.loaders.concat(loaders)};
    }
    return data;
  }

  /**
   * Find a package metadata for a specified resource.
   */
  async findPackageForResource(resource) {
    let dirname = path.dirname(resource);
    if (this._packageDirectoriesByDirectory[dirname] === undefined) {
      log(`finding package directory for ${dirname}`);
      // TODO: We are not using caching fs here.
      this._packageDirectoriesByDirectory[dirname] = findParentDirPromise(dirname, this.packageFilename);
    }
    let packageDirname = await this._packageDirectoriesByDirectory[dirname];
    if (!packageDirname) {
      log(`no package metadata found for ${resource} resource`);
      return {packageData: null, packageDirname};
    }
    if (this._packagesByDirectory[packageDirname] === undefined) {
      this._packagesByDirectory[packageDirname] = Promise.try(async () => {
        log(`reading package data for ${packageDirname}`);
        let packageFilename = path.join(packageDirname, this.packageFilename);
        // TODO: We are not using caching fs here.
        let packageSource = await readFilePromise(packageFilename, 'utf8');
        return parsePackageData(packageSource);
      });
    }
    let packageData = await this._packagesByDirectory[packageDirname];
    return {packageData, packageDirname};
  }
}
