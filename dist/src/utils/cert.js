"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAndDecryptTransportToken = exports.getTransportKey = exports.generateTransportTokenKeys = exports.getCertificate = void 0;
const fs_1 = require("fs");
const express = require("express");
const rsa = require("../crypto/rsa");
const fs = require("fs");
const logger_1 = require("./logger");
const qs = require("qs");
const axios_1 = require("axios");
const forge = require("node-forge");
const apiUrl = 'https://api.zerossl.com';
const config_1 = require("../utils/config");
const config = (0, config_1.loadConfig)();
/**
Sleep for a given number of milliseconds

@param {number} ms - The number of milliseconds to sleep for
@return {Promise} A promise that will be resolved after the given number of milliseconds
*/
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
Generates a Certificate Signing Request (CSR) with the given keys and endpoint.

@param {Object} keys The keys to use for generating the CSR.
@param {string} endpoint The endpoint to associate with the CSR.
@return {string} The generated CSR.
*/
function generateCsr(keys, endpoint) {
    let csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
        {
            name: 'commonName',
            value: endpoint,
        },
    ]);
    csr.sign(keys.privateKey);
    if (!csr.verify()) {
        logger_1.sphinxLogger.error('Verification of CSR failed.', logger_1.logging.SSL);
        throw new Error('Verification of CSR failed.');
    }
    csr = forge.pki.certificationRequestToPem(csr);
    return csr.trim();
}
/**
Makes a request to the specified URL to obtain a certificate.

@param {string} endpoint - The endpoint to request a certificate for.
@param {string} csr - The certificate signing request (CSR) for the endpoint.
@param {string} apiKey - The API key to authenticate the request.
@returns {Object} - The response data from the request.
*/
function requestCert(endpoint, csr, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield (0, axios_1.default)({
            method: 'post',
            url: `${apiUrl}/certificates?access_key=${apiKey}`,
            data: qs.stringify({
                certificate_domains: endpoint,
                certificate_validity_days: '90',
                certificate_csr: csr,
            }),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        return res.data;
    });
}
/**
Validates the provided certificate for the given endpoint by starting a
temporary HTTP server, issuing a request for validation, and waiting for
the certificate to be issued.

@param {number} port - The port number to use for the temporary HTTP server.
@param {object} data - The certificate data returned from the API.
@param {string} endpoint - The certificate endpoint (e.g. "example.com").
@param {string} apiKey - The API key for the certificate issuer.

@returns {void}
*/
function validateCert(port, data, endpoint, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const app = express();
        const validationObject = data.validation.other_methods[endpoint];
        const replacement = new RegExp(`http://${endpoint}`, 'g');
        const path = validationObject.file_validation_url_http.replace(replacement, '');
        yield app.get(path, (req, res) => {
            res.set('Content-Type', 'text/plain');
            res.send(validationObject.file_validation_content.join('\n'));
        });
        const server = yield app.listen(port, () => {
            logger_1.sphinxLogger.info(`validation server started at http://0.0.0.0:${port}`, logger_1.logging.SSL);
        });
        yield requestValidation(data.id, apiKey);
        logger_1.sphinxLogger.info(`waiting for certificate to be issued`, logger_1.logging.SSL);
        while (true) {
            const certData = yield getCert(data.id, apiKey);
            if (certData.status === 'issued') {
                logger_1.sphinxLogger.info(`certificate was issued`, logger_1.logging.SSL);
                break;
            }
            logger_1.sphinxLogger.info(`checking certificate again...`, logger_1.logging.SSL);
            yield sleep(2000);
        }
        yield server.close(() => {
            logger_1.sphinxLogger.info(`validation server stopped.`, logger_1.logging.SSL);
        });
        return;
    });
}
/**
Requests certificate validation for the specified certificate id.

@param {string} id - The certificate id
@param {string} apiKey - The API key to use for the request
@returns {Object} The response data
*/
function requestValidation(id, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield (0, axios_1.default)({
            method: 'post',
            url: `${apiUrl}/certificates/${id}/challenges?access_key=${apiKey}`,
            data: qs.stringify({
                validation_method: 'HTTP_CSR_HASH',
            }),
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        if (res.data.success === false) {
            logger_1.sphinxLogger.error(`Failed to request certificate validation`, logger_1.logging.SSL);
            logger_1.sphinxLogger.error(res.data, logger_1.logging.SSL);
            throw new Error('Failing to provision ssl certificate');
        }
        return res.data;
    });
}
/**
Makes a GET request to the /certificates/{id} endpoint of the SSL API to get certificate data.

@param {string} id - The ID of the certificate to get.
@param {string} apiKey - The API key for authentication.
@returns {Object} - The data for the certificate with the specified ID.
*/
function getCert(id, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield (0, axios_1.default)({
            method: 'get',
            url: `${apiUrl}/certificates/${id}?access_key=${apiKey}`,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        return res.data;
    });
}
/**
Asynchronously downloads a certificate.

@param {string} id - The certificate ID
@param {string} apiKey - The API key to authenticate the request
@return {Promise<Object>} - An object containing the certificate data
*/
function downloadCert(id, apiKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield (0, axios_1.default)({
            method: 'get',
            url: `${apiUrl}/certificates/${id}/download/return?access_key=${apiKey}`,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });
        return res.data;
    });
}
/**
Retrieve a TLS certificate for the specified domain.

@param {string} domain - The domain to retrieve a TLS certificate for.
@param {number} port - The port number to listen on for certificate validation.
@param {boolean} save_ssl - Whether to save the certificate and private key to disk.
@returns {Object} - An object containing the private key, certificate, and CA bundle.
*/
function getCertificate(domain, port, save_ssl) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((0, fs_1.existsSync)(__dirname + '/zerossl/tls.cert') &&
            (0, fs_1.existsSync)(__dirname + '/zerossl/tls.key')) {
            const certificate = (0, fs_1.readFileSync)(__dirname + '/zerossl/tls.cert', 'utf-8').toString();
            const caBundle = (0, fs_1.readFileSync)(__dirname + '/zerossl/ca.cert', 'utf-8').toString();
            const privateKey = (0, fs_1.readFileSync)(__dirname + '/zerossl/tls.key', 'utf-8').toString();
            return {
                privateKey: privateKey,
                certificate: certificate,
                caBundle: caBundle,
            };
        }
        const apiKey = process.env.ZEROSSL_API_KEY;
        if (!apiKey) {
            logger_1.sphinxLogger.error('ZEROSSL_API_KEY is not set', logger_1.logging.SSL);
            throw new Error('ZEROSSL_API_KEY is not set');
        }
        const endpoint_tmp = domain.replace('https://', '');
        const endpoint = endpoint_tmp.replace(':3001', '');
        const keys = forge.pki.rsa.generateKeyPair(2048);
        const csr = generateCsr(keys, endpoint);
        logger_1.sphinxLogger.info(`Generated CSR`, logger_1.logging.SSL);
        const res = yield requestCert(endpoint, csr, apiKey);
        logger_1.sphinxLogger.info(`Requested certificate`, logger_1.logging.SSL);
        yield validateCert(port, res, endpoint, apiKey);
        const certData = yield downloadCert(res.id, apiKey);
        if (save_ssl === true) {
            if (!(0, fs_1.existsSync)(__dirname + '/zerossl')) {
                yield (0, fs_1.mkdirSync)(__dirname + '/zerossl');
            }
            yield (0, fs_1.writeFile)(__dirname + '/zerossl/tls.cert', certData['certificate.crt'], function (err) {
                if (err) {
                    return logger_1.sphinxLogger.error(err);
                }
                logger_1.sphinxLogger.info(`wrote tls certificate`, logger_1.logging.SSL);
            });
            yield (0, fs_1.writeFile)(__dirname + '/zerossl/ca.cert', certData['ca_bundle.crt'], function (err) {
                if (err) {
                    return logger_1.sphinxLogger.error(err);
                }
                logger_1.sphinxLogger.info(`wrote tls ca bundle`, logger_1.logging.SSL);
            });
            yield (0, fs_1.writeFile)(__dirname + '/zerossl/tls.key', forge.pki.privateKeyToPem(keys.privateKey), function (err) {
                if (err) {
                    return logger_1.sphinxLogger.error(err);
                }
                logger_1.sphinxLogger.info(`wrote tls key`, logger_1.logging.SSL);
            });
        }
        return {
            privateKey: forge.pki.privateKeyToPem(keys.privateKey),
            certificate: certData['certificate.crt'],
            caBundle: certData['ca_bundle.crt'],
        };
    });
}
exports.getCertificate = getCertificate;
function getAndDecryptTransportToken(t) {
    return __awaiter(this, void 0, void 0, function* () {
        const transportPrivateKey = yield getTransportKey();
        const splitTransportToken = rsa.decrypt(transportPrivateKey, t).split('|');
        const token = splitTransportToken[0];
        const timestamp = parseInt(splitTransportToken[1]);
        return { token, timestamp };
    });
}
exports.getAndDecryptTransportToken = getAndDecryptTransportToken;
function getTransportKey() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!fs.existsSync(config.transportPrivateKeyLocation)) {
            yield generateTransportTokenKeys();
        }
        return fs.readFileSync(config.transportPrivateKeyLocation, 'utf8');
    });
}
exports.getTransportKey = getTransportKey;
function generateTransportTokenKeys() {
    return __awaiter(this, void 0, void 0, function* () {
        const transportTokenKeys = yield rsa.genKeys();
        fs.writeFileSync(config.transportPublicKeyLocation, transportTokenKeys.public);
        fs.writeFileSync(config.transportPrivateKeyLocation, transportTokenKeys.private);
        return transportTokenKeys.public;
    });
}
exports.generateTransportTokenKeys = generateTransportTokenKeys;
//# sourceMappingURL=cert.js.map