# Nagios Rest Server

![logo](favicon.ico)

Nest is a RESTful API server built on top of Node.js and Express.js. It is designed to be used as a drop-in replacement for the Nagios XI API.

## Building the Standalone Executable

To create a standalone executable:

1. Install the node modules:
   ```bash
   npm install
   ```
2. Run the release build script:
   ```bash
   npm run build:release
   ```
3. This will produce a standalone executable in the `standalone/` directory
4. The resulting binary includes:
   - Node.js runtime
   - All dependencies

## Debian Package Creation

To create a Debian package:

1. Run:
   ```bash
   npm run build:deb
   ```
2. This will generate a `.deb` file in the `build_deb/` directory
3. The package includes:
   - All required libraries
   - Configuration files
   - System service files

## Usage

### Running from source:

```bash
npm install
npm run dev
```

### Running standalone:

```bash
./standalone/nest
```

`sudo dpkg -i nest_*.deb` for Debian systems
