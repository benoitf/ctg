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
import * as path from 'path';
import * as util from 'util';
import * as mustache from 'mustache';
import * as readPkg from 'read-pkg';

/**
 * Generates the examples/assembly
 * @author Florent Benoit
 */
export class Init {

    // Convert fs.readFile into Promise version of same
    private static readFile = util.promisify(fs.readFile);
    private static writeFile = util.promisify(fs.writeFile);
    private static mkdir = util.promisify(fs.mkdir);

    constructor(readonly rootFolder: string, readonly examplesAssemblyFolder: string, readonly checkoutFolder: string) {

    }

    async getCurrentVersion(): Promise<string> {
        return (await readPkg(path.join(this.rootFolder, 'packages/core/package.json'))).version;
    }

    async generate(): Promise<void> {
        console.log('dirname =', __dirname);

        const templateDir = path.resolve(__dirname, '../src/templates');

        const packageJsonContent = await Init.readFile(path.join(templateDir, 'assembly-package.mst'));

        // generate assembly if does not exists
        const rendered = await this.generateAssemblyPackage(packageJsonContent.toString());
        if (!fs.existsSync(this.examplesAssemblyFolder)) {
            await Init.mkdir(this.examplesAssemblyFolder);
        }
        await Init.writeFile(path.join(this.examplesAssemblyFolder, 'package.json'), rendered);

        // Generate checkout folder is does not exist
        if (!fs.existsSync(this.checkoutFolder)) {
            await Init.mkdir(this.checkoutFolder);
        }

    }

    foo(): void {

    }
    async generateAssemblyPackage(template: string): Promise<string> {
        const version = await this.getCurrentVersion();
        const tags = { version: version };
        return mustache.render(template, tags);
    }

}
