/*********************************************************************
* Copyright (c) 2018 Red Hat, Inc.
*
* This program and the accompanying materials are made
* available under the terms of the Eclipse Public License 2.0
* which is available at https://www.eclipse.org/legal/epl-2.0/
*
* SPDX-License-Identifier: EPL-2.0
**********************************************************************/
import * as fs from 'fs-extra';
import { Logger } from './logger';
import { Yarn } from './yarn';
import { CliError } from './cli-error';
import * as glob from 'glob-promise';
import * as path from 'path';

/**
 * Generates the plugin assembly (zip file)
 * @author Florent Benoit
 */
export class Production {

    private dependencies: string[] = [];
    private toCopyFiles: string[] = [];
    private static readonly ASSEMBLY_DIRECTORY = path.resolve('examples/assembly');
    private static readonly TARGET_DIRECTORY = 'production';

    constructor(readonly rootFolder: string) {
        this.dependencies = [];
    }

    public async create(): Promise<fs.PathLike> {

        Logger.info('🗂  Get dependencies...');
        // get dependencies
        await this.getDependencies();

        Logger.info('🗃  Resolving files...');
        await this.resolveFiles();

        const rootDir = path.resolve('');
        const assemblyLength = Production.ASSEMBLY_DIRECTORY.length;
        const rootDirLength = rootDir.length;
        Logger.info('✍️  Copying files...');
        await Promise.all(this.toCopyFiles.map((file) => {

            let destFile;
            if (file.startsWith(Production.ASSEMBLY_DIRECTORY)) {
                destFile = file.substring(assemblyLength);
            } else {
                destFile = file.substring(rootDirLength);
            }
            return fs.copy(file, path.join(Production.TARGET_DIRECTORY, destFile));
        }));
        Logger.info(`🎉  Theia production-ready available in ${Production.TARGET_DIRECTORY}.`);

        return path.join(Production.TARGET_DIRECTORY);
    }

    public async resolveFiles(): Promise<boolean> {
        // check dependency folders are there
        this.dependencies.forEach((dependency) => {
            if (!fs.existsSync(dependency)) {
                throw new CliError('The dependency ' + dependency
                    + ' is referenced but is not available on the filesystem');
            }
        });

        // ok now, add all files from these dependencies except their sub folder node_modules as we already got them
        const globOptions = { nocase: true, nosort: true, nodir: true, dot: true };
        this.toCopyFiles = this.toCopyFiles.concat.apply([],
            await Promise.all(this.dependencies.map((dependencyDirectory) => {
                return glob.promise('**', Object.assign(globOptions, { cwd: dependencyDirectory }))
                    .then((data) => data.map((name) => path.join(dependencyDirectory, name)));
            })));

        // add as well the lib folder
        this.toCopyFiles = this.toCopyFiles.concat(
            await (glob.promise('lib/**', Object.assign(globOptions, { cwd: this.rootFolder }))
                .then((data) => data.map((name) => path.join(this.rootFolder, name)))));

        this.toCopyFiles = this.toCopyFiles.concat(
            await (glob.promise('src-gen/**', Object.assign(globOptions, { cwd: this.rootFolder }))
                .then((data) => data.map((name) => path.join(this.rootFolder, name)))));

        this.toCopyFiles = this.toCopyFiles.concat(path.join(this.rootFolder, 'package.json'));
        return Promise.resolve(true);

    }

    public async getDependencies(): Promise<boolean> {
        this.dependencies = (await new Yarn('', './examples/assembly').getDependencies());
        return Promise.resolve(true);
    }

}
