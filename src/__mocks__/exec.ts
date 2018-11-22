/*********************************************************************
* Copyright (c) 2018 Red Hat, Inc.
*
* This program and the accompanying materials are made
* available under the terms of the Eclipse Public License 2.0
* which is available at https://www.eclipse.org/legal/epl-2.0/
*
* SPDX-License-Identifier: EPL-2.0
**********************************************************************/

'use strict';

export class Exec {

    // mock any command by providing the output
    public static __setCommandOutput(command: string, output: string): void {
        Exec.map.set(command, output);
    }

    constructor() {

    }

    public async run(command: string): Promise<string> {
        const result = Exec.map.get(command);
        if (result) {
            return Promise.resolve(result);
        } else {
            return Promise.resolve('');
        }
    }

    private static readonly map: Map<string, string> = new Map();

}
