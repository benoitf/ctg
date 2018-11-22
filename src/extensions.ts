/*********************************************************************
* Copyright (c) 2018 Red Hat, Inc.
*
* This program and the accompanying materials are made
* available under the terms of the Eclipse Public License 2.0
* which is available at https://www.eclipse.org/legal/epl-2.0/
*
* SPDX-License-Identifier: EPL-2.0
**********************************************************************/
import * as jsYaml from 'js-yaml';
import * as path from 'path';
import * as utilAsync from './async';
import * as childProcess from 'child_process';
import * as readPkg from 'read-pkg';

/**
 * Init all extensions into packages folder
 * @author Florent Benoit
 */
export class Extensions {

    private globalDevDependencies = new Map<string, string>();

    constructor(readonly rootFolder: string, readonly packagesFolder: string, readonly cheTheiaFolder: string, readonly assemblyFolder: string, readonly theiaVersion: string) {

    }

    /**
     * Install all extensions
     */
    async generate(): Promise<void> {

        const confDir = path.resolve(__dirname, '../src/conf');

        const extensionsYamlContent = await utilAsync.FS.readFile(path.join(confDir, 'extensions.yml'));
        const extensionsYaml = jsYaml.load(extensionsYamlContent.toString());

        await this.initGlobalDependencies();

        await Promise.all(extensionsYaml.extensions.map(async (extension: IExtension) => {
            await this.addExtension(extension);
        }));

    }

    async initGlobalDependencies(): Promise<void> {
        const extensionPackage: any = await readPkg(path.join(this.rootFolder, 'package.json'), { normalize: false });

        const keys = Object.keys(extensionPackage.devDependencies);
        await Promise.all(keys.map(key => {
            this.globalDevDependencies.set(key, extensionPackage.devDependencies[key]);
        }));
    }

    async addExtension(extension: IExtension): Promise<void> {

        // first, clone
        console.log(`Cloning ${extension.source}...`);
        this.clone(extension);

        // perform symlink
        await this.symlink(extension);

        await this.updateDependencies(extension);

        // insert extensions
        await this.insertExtensionIntoAssembly(extension);

    }

    // now perform update of devDependencies or dependencies
    async updateDependencies(extension: IExtension): Promise<void> {

        await Promise.all(extension.symbolicLinks.map(async symbolicLink => {
            // grab package.json
            const extensionJsonPath = path.join(symbolicLink, 'package.json');
            const extensionPackage = await readPkg(extensionJsonPath, { normalize: false });
            const rawExtensionPackage = require(extensionJsonPath);

            const dependencies: any = extensionPackage.dependencies;
            const devDependencies: any = extensionPackage.devDependencies;
            const updatedDependencies: any = {};
            const updatedDevDependencies: any = {};

            const keysDependencies = Object.keys(dependencies);
            await Promise.all(keysDependencies.map(async key => {
                updatedDependencies[key] = this.updateDependency(key, dependencies[key]);
            }));

            rawExtensionPackage['dependencies'] = updatedDependencies;
            const keysDevDependencies = Object.keys(devDependencies);
            await Promise.all(keysDevDependencies.map(async key => {
                updatedDevDependencies[key] = this.updateDependency(key, devDependencies[key]);
            }));

            rawExtensionPackage['devDependencies'] = updatedDevDependencies;

            // write again the file
            const json = JSON.stringify(rawExtensionPackage, undefined, 2);
            await utilAsync.FS.writeFile(extensionJsonPath, json);

        }));
    }

    /**
     * Update the given dependency by comparing with global dependencies or checking if it's a theia dependency.
     * @param dependencyKey the key of dependency
     * @param dependencyValue its original value
     */
    updateDependency(dependencyKey: string, dependencyValue: string) {

        // is it already defined as a Theia dev dependency ? if yes then return this value
        const rest = this.globalDevDependencies.get(dependencyKey);
        if (rest) {
            return rest;
        }

        // is it a theia dependency
        if (dependencyKey.startsWith('@theia/')) {
            // add carret and the current version
            return `^${this.theiaVersion}`;
        }
        // return default value
        return dependencyValue;
    }

    /**
     *
     * @param extension Insert the given extension into the package.json of the assembly
     */
    async insertExtensionIntoAssembly(extension: IExtension) {

        // first, read the assembly json file
        const assemblyPackageJsonPath = path.join(this.assemblyFolder, 'package.json');
        const assemblyJsonRawContent = require(assemblyPackageJsonPath);
        const dependencies = assemblyJsonRawContent.dependencies;
        extension.symbolicLinks.forEach(extensionSymLink => {

            // first resolve path
            const resolvedPath = path.resolve(extensionSymLink, 'package.json');

            // read extension name within symlink
            const extensionName = require(resolvedPath).name;
            const extensionVersion = require(resolvedPath).version;
            dependencies[extensionName] = extensionVersion;
        });
        const json = JSON.stringify(assemblyJsonRawContent, undefined, 2);
        await utilAsync.FS.writeFile(assemblyPackageJsonPath, json);
    }

    async symlink(extension: IExtension): Promise<void> {

        const symbolicLinks: string[] = [];

        // now, perform symlink for specific folder or current folder
        if (extension.folders) {
            // ok here we have several folders, need to iterate
            await Promise.all(extension.folders.map(async folder => {

                // source folder
                const sourceFolder = path.resolve(extension.clonedDir, folder);
                const dest = path.resolve(this.packagesFolder, `@che-${path.basename(sourceFolder)}`);
                console.log(`Creating symlink from ${sourceFolder} to ${dest}`);
                await utilAsync.FS.symlink(sourceFolder, dest);
                symbolicLinks.push(dest);
            }));
        } else {
            const dest = path.resolve(this.packagesFolder, `@che-${path.basename(extension.clonedDir)}`);
            console.log(`Creating symlink from ${extension.clonedDir} to ${dest}`);
            await utilAsync.FS.symlink(extension.clonedDir, dest);
            symbolicLinks.push(dest);
        }

        extension.symbolicLinks = symbolicLinks;

    }

    clone(extension: IExtension): void {
        const regex = /https:\/\/github.com\/.*\/(.*)/gm;
        const folderDirExp = regex.exec(extension.source);
        if (!folderDirExp || folderDirExp.length < 1) {
            throw new Error('Invalid repository name:' + extension.source);
        }
        const folderDir = folderDirExp[1];

        const ret = childProcess.spawnSync('git', ['clone', `${extension.source}`, `${folderDir}`], { cwd: this.cheTheiaFolder, stdio: [0, 1, 2] });
        if (ret.error) {
            throw new Error(ret.error.message);
        }
        extension.clonedDir = path.resolve(this.cheTheiaFolder, folderDir);

        if (extension.checkoutTo) {
            // need to change checkout
            childProcess.spawnSync('git', ['checkout', extension.checkoutTo], { cwd: `${extension.clonedDir}`, stdio: [0, 1, 2] });
        }

    }

}

export interface IExtension {
    source: string,
    checkoutTo: string,
    type: string,
    folders: string[],
    clonedDir: string;
    symbolicLinks: string[]
}
