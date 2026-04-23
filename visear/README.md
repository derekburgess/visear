# Visear Frontend

## Run Electron App

Install Node modules:

`npm install`

Make chrome-sandbox executable:

`sudo chown root:root node_modules/electron/dist/chrome-sandbox`

`sudo chmod 4755 node_modules/electron/dist/chrome-sandbox`

Start the API:

`npm start`

## Building and running for Linux

`npm run build:linux`

From the Visear repo:

`./dist/Visear-1.x.x.AppImage --no-sandbox`

## Building and running for Mac

`npm run build:mac`

That's it!