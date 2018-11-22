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
import * as util from 'util';
import * as childProcess from 'child_process';

export class FS {
    static readFile = util.promisify(fs.readFile);
    static writeFile = util.promisify(fs.writeFile);
    static exists = util.promisify(fs.exists);
    static mkdir = util.promisify(fs.mkdir);
    static symlink = util.promisify(fs.symlink);
}

export class CP {
    static exec = util.promisify(childProcess.exec);
}
