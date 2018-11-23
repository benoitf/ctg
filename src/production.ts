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
import * as utilAsync from './async';

import * as glob from 'glob-promise';
import * as path from 'path';
import { Exec } from './exec';

/**
 * Generates the plugin assembly (zip file)
 * @author Florent Benoit
 */
export class Production {

    /**
     * Ensure we've no dependencies to these packages that bring a lot of dependencies !
     */
    private static FORBIDDEN_PACKAGES = ['webpack', 'webpack-cli', '@theia/application-manager'];

    /**
     * Remove these client dependencies as they're already bundled with webpack
     */
    private static EXCLUDED_PACKAGES = ['electron',
        'react',
        'react-virtualized',
        'onigasm',
        'oniguruma',
        '@theia/monaco',
        'monaco-css',
        'react-dom',
        'font-awesome',
        'monaco-html',
        '@typefox/monaco-editor-core'];

    private dependencies: string[] = [];
    private toCopyFiles: string[] = [];
    private static readonly ASSEMBLY_DIRECTORY = path.resolve('examples/assembly');
    private static readonly TARGET_DIRECTORY = 'production';
    private exec: Exec;

    constructor(readonly rootFolder: string, readonly assemblyFolder: string) {
        this.dependencies = [];
        this.exec = new Exec(Production.TARGET_DIRECTORY);
    }

    public async create(): Promise<fs.PathLike> {

        Logger.info('🗂  Get dependencies...');
        // get dependencies
        await this.getDependencies();

        Logger.info('🗃  Resolving files...');
        await this.resolveFiles();

        Logger.info('✍️  Copying files...');
        await this.copyFiles();

        Logger.info('✂️  Cleaning-up files...');
        await this.cleanup();

        Logger.info(`🎉  Theia production-ready available in ${Production.TARGET_DIRECTORY}.`);

        return path.join(Production.TARGET_DIRECTORY);
    }

    protected async copyFiles(): Promise<void> {
        const rootDir = path.resolve('');
        const assemblyLength = Production.ASSEMBLY_DIRECTORY.length;
        const rootDirLength = rootDir.length;
        await Promise.all(this.toCopyFiles.map((file) => {

            let destFile;
            if (file.startsWith(Production.ASSEMBLY_DIRECTORY)) {
                destFile = file.substring(assemblyLength);
            } else {
                destFile = file.substring(rootDirLength);
            }
            return fs.copy(file, path.join(Production.TARGET_DIRECTORY, destFile));
        }));
    }

    protected async cleanup(): Promise<void> {
        const sizeBefore = await this.getSize();

        await this.yarnClean();
        await this.cleanupFind();
        await this.cleanupExact();
        const sizeAfter = await this.getSize();
        console.log('Gain size after is :' + (sizeBefore - sizeAfter) + ':');
    }

    protected async getSize(): Promise<number> {
        return parseInt(await this.exec.run('du -s -k . | cut -f1'), 10);
    }

    protected async yarnClean() {
        const yarnCleanFolder = path.resolve(__dirname, '../src/conf');
        const yarnCleanPath = path.join(yarnCleanFolder, '.yarnclean');

        await fs.copy(path.join(this.rootFolder, 'yarn.lock'), path.join(Production.TARGET_DIRECTORY, 'yarn.lock'));
        await fs.copy(yarnCleanPath, path.join(Production.TARGET_DIRECTORY, '.yarnclean'));
        const before = await this.getSize();
        const output = await this.exec.run('yarn autoclean --force');
        const after = await this.getSize();
        console.log('freeing ' + (before - after) + ' for yarn clean');
        console.log('cleanup output=', output);
    }

    protected async cleanupFind() {
        const cleanupFindFolder = path.resolve(__dirname, '../src/conf');

        const cleanupFindContent = await utilAsync.FS.readFile(path.join(cleanupFindFolder, 'cleanup-find'));
        const exec = new Exec(Production.TARGET_DIRECTORY);
        await Promise.all(cleanupFindContent.toString().split('\n').map(async (line) => {
            if (line.length > 0 && !line.startsWith('#')) {
                const before = await this.getSize();
                await exec.run(`find . -name ${line} | xargs rm -rf {}`);
                const after = await this.getSize();
                console.log('freeing ' + (before - after) + ' for line ' + line);

            }
        }));

    }

    protected async cleanupExact() {
        const cleanupExactFolder = path.resolve(__dirname, '../src/conf');

        const cleanupExactContent = await utilAsync.FS.readFile(path.join(cleanupExactFolder, 'cleanup-exact'));
        const exec = new Exec(Production.TARGET_DIRECTORY);
        await Promise.all(cleanupExactContent.toString().split('\n').map(async (line) => {
            if (line.length > 0 && !line.startsWith('#')) {
                const before = await this.getSize();
                await exec.run(`rm -rf ${line}`);
                const after = await this.getSize();
                console.log('freeing ' + (after - before) + ' for line ' + line);

            }
        }));

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
            await (glob.promise('lib/**', Object.assign(globOptions, { cwd: this.assemblyFolder }))
                .then((data) => data.map((name) => path.join(this.assemblyFolder, name)))));

        this.toCopyFiles = this.toCopyFiles.concat(
            await (glob.promise('src-gen/**', Object.assign(globOptions, { cwd: this.assemblyFolder }))
                .then((data) => data.map((name) => path.join(this.assemblyFolder, name)))));

        this.toCopyFiles = this.toCopyFiles.concat(path.join(this.assemblyFolder, 'package.json'));
        return Promise.resolve(true);

    }

    public async getDependencies(): Promise<boolean> {

        this.dependencies = (await new Yarn('',
            Production.ASSEMBLY_DIRECTORY,
            Production.FORBIDDEN_PACKAGES,
            Production.EXCLUDED_PACKAGES).getDependencies('x@eclipse-che/theia-assembly'));
        return Promise.resolve(true);
    }

}
