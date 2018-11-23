/*********************************************************************
* Copyright (c) 2018 Red Hat, Inc.
*
* This program and the accompanying materials are made
* available under the terms of the Eclipse Public License 2.0
* which is available at https://www.eclipse.org/legal/epl-2.0/
*
* SPDX-License-Identifier: EPL-2.0
**********************************************************************/

import * as path from 'path';
import { Exec } from './exec';
import { Logger } from './logger';
/**
 * Handle the parsing of node packages with Yarn.
 * It allows to grab direct dependencies (not the dev dependencies)
 * @author Florent Benoit
 */
export class Yarn {

    public static readonly YARN_GET_DEPENDENCIES = 'yarn list --json --prod';

    public static readonly YARN_GET_CONFIG = 'yarn config current --json';

    constructor(readonly rootFolder: string,
        private readonly dependenciesDirectory: string,
        private readonly forbiddenPackages: string[],
        private readonly excludedPackages: string[]) { }

    /**
     * Get package.json dependency paths (not including dev dependencies)
     */
    public async getDependencies(rootModule: string): Promise<string[]> {

        // grab output of the command
        const exec = new Exec(this.dependenciesDirectory);
        const stdout = await exec.run(Yarn.YARN_GET_DEPENDENCIES);

        // Check that we've tree array
        const match = /^{"type":"tree","data":{"type":"list","trees":(.*)}}$/gm.exec(stdout);
        if (!match || match.length !== 2) {
            throw new Error('Not able to find a dependency tree when executing '
                + Yarn.YARN_GET_DEPENDENCIES + '. Found ' + stdout);
        }

        // parse array into JSON
        const inputTrees: IYarnNode[] = JSON.parse(match[1]);

        // Get node_modules folder
        const configStdout = await exec.run(Yarn.YARN_GET_CONFIG);

        const matchConfig = /^{"type":"log","data":"(.*)"}$/gm.exec(configStdout);
        if (!matchConfig || matchConfig.length !== 2) {
            throw new Error('Not able to get yarn configuration when executing '
                + Yarn.YARN_GET_CONFIG + '. Found ' + configStdout);
        }

        // parse array into JSON
        const unescaped = matchConfig[1].replace(/\\n/g, '').replace(/\\"/g, '"');
        const jsonConfig = JSON.parse(unescaped);
        let nodeModulesFolder = jsonConfig.modulesFolder;
        if (!nodeModulesFolder) {
            nodeModulesFolder = path.resolve(this.rootFolder, 'node_modules');
        }

        // add each yarn node (and loop through children of children)
        const nodePackages: INodePackage[] = [];

        const nodeTreeDependencies = new Map<string, string[]>();

        inputTrees.map(yarnNode => this.insertNode(yarnNode, nodeTreeDependencies));

        // now, capture only expected dependencies
        const subsetDependencies: string[] = [];
        const initNode = nodeTreeDependencies.get(rootModule);
        if (!initNode) {
            throw new Error(`The initial module ${rootModule} was not found in dependencies`);
        }
        this.findDependencies(initNode!, nodeTreeDependencies, subsetDependencies);
        subsetDependencies.forEach(moduleName => this.addNodePackage(nodeModulesFolder, moduleName, nodePackages));

        // return unique entries
        return Promise.resolve(nodePackages.map((e) => e.path).filter((value, index, array) => {
            return index === array.indexOf(value);
        }));
    }

    protected findDependencies(children: string[], nodeTreeDependencies: Map<string, string[]>, subsetDependencies: string[]): void {
        children.map(child => {
            // only loop on exist
            if (subsetDependencies.indexOf(child) < 0) {
                subsetDependencies.push(child);

                // loop on children in any
                let depChildren = nodeTreeDependencies.get(child);
                if (depChildren) {
                    depChildren = depChildren.filter(depChild => {
                        const res = this.excludedPackages.indexOf(depChild) < 0;
                        if (!res) {
                            Logger.debug(` --> Excluding the dependency ${depChild}`);
                        }
                        return res;
                    });

                    const matching: string[] = [];
                    const foundForbiddenPackage = depChildren.some(r => {
                        const res = this.forbiddenPackages.indexOf(r) >= 0;
                        if (res) {
                            matching.push(r);
                        }
                        return res;
                    });
                    if (foundForbiddenPackage) {
                        throw new Error(`Forbidden dependencies ${matching} has been found as dependencies of ${child}` +
                            `Current dependencies: ${depChildren}, excluded list: ${this.forbiddenPackages}`);
                    }
                    this.findDependencies(depChildren, nodeTreeDependencies, subsetDependencies);
                }
            }
        });
    }

    protected insertNode(yarnNode: IYarnNode, nodeTreeDependencies: Map<string, string[]>): void {
        const npmModuleName = yarnNode.name.substring(0, yarnNode.name.lastIndexOf('@'));

        // check if already exists ?
        let dependencies = nodeTreeDependencies.get(npmModuleName);
        if (!dependencies) {
            dependencies = [];
            nodeTreeDependencies.set(npmModuleName, dependencies);
        }

        yarnNode.children.map(child => {
            const childName = child.name.substring(0, child.name.lastIndexOf('@'));
            if (dependencies!.indexOf(childName) < 0) {
                dependencies!.push(childName);
            }

        });
    }

    /**
     * Add a node package (entry of yarn list) to the given array.
     * Also loop on all children and call ourself back
     * @param nodeModulesFolder the node_modules location
     * @param yarnNode the node entry to add
     * @param packages the array representing all node dependencies
     */
    protected async addNodePackage(nodeModulesFolder: string, moduleName: string, packages: INodePackage[]): Promise<void> {

        // build package
        const nodePackage = { name: moduleName, path: path.resolve(nodeModulesFolder, moduleName) };

        // add to the array
        packages.push(nodePackage);
    }

}

export interface INodePackage {
    name: string;
    path: string;
}

export interface IYarnNode {
    name: string;
    children: IYarnNode[];
}
