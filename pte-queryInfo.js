/**
 * Copyright 2016 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */


'use strict';

// fabric-sdk-node requires
const networkGateway = require('fabric-network/lib/gateway.js');
const fabricCAServices = require('fabric-ca-client');
const fabricProtos = require('fabric-protos');
const BlockDecoder = require('fabric-common/lib/BlockDecoder.js');

const pteUtil = require('./pte-util.js');

let loggerMsg = `PTE queryInfo`;
let logger = new pteUtil.PTELogger({ "prefix": loggerMsg, "level": "info" });

async function blockTxCount(channelName, network, queryinfoOpt) {

    try {
        let txCount = 0;
        let txValidCount = 0;
        let sBlk = parseInt(queryinfoOpt.startBlock);
        let eBlk = parseInt(queryinfoOpt.endBlock);
        const contract = network.getContract('qscc');
        for (let blkid = sBlk; blkid <= eBlk; blkid++) {
            const resultBuffer = await contract.evaluateTransaction('GetBlockByNumber', channelName, blkid);
            const block = BlockDecoder.decode(resultBuffer);
            for (let x = 0; x < block.data.data.length; x++) {
                const data = block.data.data[x];
                if (data.payload.header.channel_header.type === 3) {
                    const status = block.metadata.metadata[2][x];
                    const statusString = fabricProtos.protos.TxValidationCode[status]
                    txCount++;
                    if ( statusString === 'VALID' ) {
                        txValidCount++;
                    }
                }
            }
        }
        logger.info(`**** blocks: ${sBlk} - ${eBlk}, transaction count: ${txCount}, valid: ${txValidCount}, invlaid: ${txCount-txValidCount}`);
    } catch (err) {
        logger.error(`Error: ${err}`);
    //} finally {
        // Disconnect from the gateway peer when all work for this client identity is complete
        //logger.info(`Close gateway`);
        //gateway.disconnect();
    }
}

/**
 * get the block height
 *
 * @param {string} channelName The channel name
 * @param {string} network The network object
 * @returns {object} The object of channelInfo
 **/
async function getBlockHeight(channelName, network) {
    const contractInfo = network.getContract('qscc');
    const transInfo = contractInfo.createTransaction('GetChainInfo');
    const result = await transInfo.evaluate(channelName);
    // the result is a gRPC serialized message
    const channelInfo = fabricProtos.common.BlockchainInfo.decode(result);
    return channelInfo;
}

/**
 * query block info
 *
 * @param {string} org The organization
 * @param {string} channelName The channel name
 * @param {string} cpf The connection profile that contains the org
 * @returns {object} network The network object
 **/
async function queryInfo(org, channelName, cpf) {
    try {
        // set gateway
        let orgCA = cpf.organizations[org].certificateAuthorities[0];
        const caInfo = cpf.certificateAuthorities[orgCA];
        const caTLSCACerts = caInfo.tlsCACerts['pem'];
        const ca = new fabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        // create identity
        let username = pteUtil.getOrgEnrollId(cpf, org);
        let secret = pteUtil.getOrgEnrollSecret(cpf, org);

        const enrollment = await ca.enroll({
                                     enrollmentID: username,
                                     enrollmentSecret: secret
                                 });

        const x509Identity = {
                  credentials: {
                      certificate: enrollment.certificate,
                      privateKey: enrollment.key.toBytes(),
                  },
                  mspId: cpf.organizations[org].mspid,
                  type: 'X.509',
              };

        const gateway = new networkGateway.Gateway();

        // connect gateway to connection profile
        await gateway.connect(cpf, {
                  identity: x509Identity
              });

        const network = await gateway.getNetwork(channelName);
        return network;

    } catch (err) {
        logger.error(err);
        return null;
    }
}

/**
 * query block info handler
 *
 * @param {string} org The organization
 * @param {string} channelName The channel name
 * @param {string} cpf The connection profile that contains the org
 * @returns {Promise<void>}
 **/
async function QIHandler(org, channelName, cpf, queryinfoOpt) {
    let network = await queryInfo(org, channelName, cpf);
    if ( network ) {
        let channelInfo = await getBlockHeight(channelName, network);
        logger.info(`[QIHandler] queryInfo channel: ${channelName}`);
        logger.info(`[QIHandler]            height: ${channelInfo.height.toString()}`);
        logger.info('[QIHandler]           channelInfo: %j', channelInfo);
    } else {
        logger.info('[QIHandler] invalid network');
    }
    logger.info('[QIHandler] queryinfoOpt: %j', queryinfoOpt);
    await blockTxCount(channelName, network, queryinfoOpt);
}

// module exports
module.exports.queryInfo = queryInfo;
module.exports.QIHandler = QIHandler;
