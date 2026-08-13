'use strict'

const { spawn } = require('node:child_process')

if (process.env.ELECTRON_RUN_AS_NODE !== '1') process.exit(9)
if (spawn.name !== 'desktopSpawn') process.exit(8)
