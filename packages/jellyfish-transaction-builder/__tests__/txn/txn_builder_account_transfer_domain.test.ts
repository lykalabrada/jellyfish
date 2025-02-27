import { DeFiDRpcError, MasterNodeRegTestContainer } from '@defichain/testcontainers'
import { getProviders, MockProviders } from '../provider.mock'
import { P2WPKHTransactionBuilder } from '../../src'
import { fundEllipticPair, sendTransaction } from '../test.utils'
import BigNumber from 'bignumber.js'
import { Testing } from '@defichain/jellyfish-testing'
import { RegTest, RegTestFoundationKeys } from '@defichain/jellyfish-network'
import {
  OP_CODES,
  Script,
  TransferDomain
} from '@defichain/jellyfish-transaction'
import { WIF } from '@defichain/jellyfish-crypto'
import { P2WPKH } from '@defichain/jellyfish-address'

const TRANSFER_DOMAIN_TYPE = {
  DVM: 2,
  EVM: 3
}

const container = new MasterNodeRegTestContainer()
const testing = Testing.create(container)

let providers: MockProviders
let builder: P2WPKHTransactionBuilder

let dvmAddr: string
let dvmScript: Script
let evmScript: Script

describe('transferDomain', () => {
  beforeAll(async () => {
    await testing.container.start()
    await testing.container.waitForWalletCoinbaseMaturity()

    await testing.rpc.masternode.setGov({
      ATTRIBUTES: {
        'v0/params/feature/evm': 'true',
        'v0/params/feature/transferdomain': 'true',
        'v0/transferdomain/dvm-evm/enabled': 'true',
        'v0/transferdomain/dvm-evm/src-formats': ['p2pkh', 'bech32'],
        'v0/transferdomain/dvm-evm/dest-formats': ['erc55'],
        'v0/transferdomain/evm-dvm/src-formats': ['erc55'],
        'v0/transferdomain/evm-dvm/auth-formats': ['bech32-erc55'],
        'v0/transferdomain/evm-dvm/dest-formats': ['p2pkh', 'bech32']
      }
    })
    await testing.generate(2)

    providers = await getProviders(testing.container)
    providers.setEllipticPair(WIF.asEllipticPair(RegTestFoundationKeys[0].owner.privKey))

    dvmAddr = await providers.getAddress()
    dvmScript = await providers.elliptic.script()
    evmScript = await providers.elliptic.evmScript()

    await testing.token.dfi({ address: dvmAddr, amount: 12 })
    await testing.generate(1)

    // Fund 100 DFI UTXO
    await fundEllipticPair(testing.container, providers.ellipticPair, 100)
    await providers.setupMocks(true)

    builder = new P2WPKHTransactionBuilder(
      providers.fee,
      providers.prevout,
      providers.elliptic,
      RegTest
    )
  })

  afterAll(async () => {
    await testing.container.stop()
  })

  describe('transferDomain failed', () => {
    it('should fail if transfer within same domain', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript,
            amount: {
              token: 0,
              amount: new BigNumber(10)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM // <-- same domain
          },
          dst: {
            address: evmScript,
            amount: {
              token: 0,
              amount: new BigNumber(10)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM // <-- same domain
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Cannot transfer inside same domain (code 16)')
    })

    it('should fail if amount is different', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript,
            domain: TRANSFER_DOMAIN_TYPE.DVM,
            amount: {
              token: 0,
              amount: new BigNumber(1) // <-- not match
            }
          },
          dst: {
            address: evmScript,
            domain: TRANSFER_DOMAIN_TYPE.EVM,
            amount: {
              token: 0,
              amount: new BigNumber(2) // <-- not match
            }
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Source amount must be equal to destination amount (code 16)')
    })

    it('should fail if transfer other than DFI token', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript,
            domain: TRANSFER_DOMAIN_TYPE.DVM,
            amount: {
              token: 1, // <- not DFI
              amount: new BigNumber(3)
            }
          },
          dst: {
            address: evmScript,
            domain: TRANSFER_DOMAIN_TYPE.EVM,
            amount: {
              token: 1, // <- not DFI
              amount: new BigNumber(3)
            }
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Non-DAT or LP tokens are not supported for transferdomain (code 16)')
    })

    it('(dvm -> evm) should fail if source address and source domain are not match', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: evmScript, // <- not match
            domain: TRANSFER_DOMAIN_TYPE.DVM, // <- not match
            amount: {
              token: 0,
              amount: new BigNumber(3)
            }
          },
          dst: {
            address: dvmScript,
            domain: TRANSFER_DOMAIN_TYPE.EVM,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            }
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Src address must be a legacy or Bech32 address in case of "DVM" domain (code 16)\', code: -26')
    })

    it('(evm -> dvm) should fail if source address and source domain are not match', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript, // <- not match
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.EVM // <- not match
          },
          dst: {
            address: dvmScript,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Src address must be an ERC55 address in case of "EVM" domain (code 16)\', code: -26')
    })

    it('(dvm -> evm) should fail if destination address and destination domain are not match', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM
          },
          dst: {
            address: dvmScript, // <- not match
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.EVM // <- not match
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Dst address must be an ERC55 address in case of "EVM" domain (code 16)')
    })

    it('(evm -> dvm) should fail if destination address and destination domain are not match', async () => {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: evmScript,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.EVM
          },
          dst: {
            address: evmScript, // <- not match
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM // <- not match
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: Dst address must be a legacy or Bech32 address in case of "DVM" domain (code 16)\', code: -26')
    })

    it('(dvm -> evm) should fail if address is not owned', async () => {
      const invalidDvmScript = P2WPKH.fromAddress(RegTest, await testing.container.getNewAddress(), P2WPKH).getScript()

      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: invalidDvmScript,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.DVM
          },
          dst: {
            address: evmScript,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            domain: TRANSFER_DOMAIN_TYPE.EVM
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, invalidDvmScript)
      const promise = sendTransaction(testing.container, txn)

      await expect(promise).rejects.toThrow(DeFiDRpcError)
      await expect(promise).rejects.toThrow('DeFiDRpcError: \'TransferDomainTx: tx must have at least one input from account owner (code 16)')
    })
  })

  it('should transfer domain from DVM to EVM', async () => {
    const dvmAccBefore = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceBefore0, tokenIdBefore0] = dvmAccBefore[0].split('@')

    const transferDomain: TransferDomain = {
      items: [{
        src:
        {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        },
        dst: {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        }
      }]
    }

    const txn = await builder.account.transferDomain(transferDomain, dvmScript)
    const outs = await sendTransaction(container, txn)
    const encoded: string = OP_CODES.OP_DEFI_TX_TRANSFER_DOMAIN(transferDomain).asBuffer().toString('hex')
    const expectedTransferDomainScript = `6a${encoded}`

    expect(outs.length).toStrictEqual(2)
    expect(outs[0].value).toStrictEqual(0)
    expect(outs[0].n).toStrictEqual(0)
    expect(outs[0].tokenId).toStrictEqual(0)
    expect(outs[0].scriptPubKey.asm.startsWith('OP_RETURN 4466547838')).toStrictEqual(true)
    expect(outs[0].scriptPubKey.hex).toStrictEqual(expectedTransferDomainScript)
    expect(outs[0].scriptPubKey.type).toStrictEqual('nulldata')

    expect(outs[1].value).toEqual(expect.any(Number))
    expect(outs[1].n).toStrictEqual(1)
    expect(outs[1].tokenId).toStrictEqual(0)
    expect(outs[1].scriptPubKey.type).toStrictEqual('witness_v0_keyhash')
    expect(outs[1].scriptPubKey.addresses[0]).toStrictEqual(dvmAddr)

    const dvmAccAfter = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceAfter0, tokenIdAfter0] = dvmAccAfter[0].split('@')
    expect(tokenIdBefore0).toStrictEqual(tokenIdAfter0)

    // check: dvm balance is transferred
    expect(new BigNumber(dvmBalanceAfter0))
      .toStrictEqual(new BigNumber(dvmBalanceBefore0).minus(3))

    // check: evm balance = dvm balance - transferred
    const withoutEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: false })
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth))
      .toStrictEqual(new BigNumber(withEth).minus(3))
  })

  it('should transfer domain from EVM to DVM', async () => {
    const dvmAccBefore = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceBefore0, tokenIdBefore0] = dvmAccBefore[0].split('@')

    const transferDomain: TransferDomain = {
      items: [{
        src:
        {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        },
        dst: {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        }
      }]
    }

    const txn = await builder.account.transferDomain(transferDomain, dvmScript)
    const outs = await sendTransaction(container, txn)
    const encoded: string = OP_CODES.OP_DEFI_TX_TRANSFER_DOMAIN(transferDomain).asBuffer().toString('hex')
    const expectedTransferDomainScript = `6a${encoded}`

    expect(outs.length).toStrictEqual(2)
    expect(outs[0].value).toStrictEqual(0)
    expect(outs[0].n).toStrictEqual(0)
    expect(outs[0].tokenId).toStrictEqual(0)
    expect(outs[0].scriptPubKey.asm.startsWith('OP_RETURN 4466547838')).toStrictEqual(true)
    expect(outs[0].scriptPubKey.hex).toStrictEqual(expectedTransferDomainScript)
    expect(outs[0].scriptPubKey.type).toStrictEqual('nulldata')

    expect(outs[1].value).toEqual(expect.any(Number))
    expect(outs[1].n).toStrictEqual(1)
    expect(outs[1].tokenId).toStrictEqual(0)
    expect(outs[1].scriptPubKey.type).toStrictEqual('witness_v0_keyhash')
    expect(outs[1].scriptPubKey.addresses[0]).toStrictEqual(dvmAddr)

    const dvmAccAfter = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceAfter0, tokenIdAfter0] = dvmAccAfter[0].split('@')
    expect(tokenIdBefore0).toStrictEqual(tokenIdAfter0)

    // check: dev balance is updated
    expect(new BigNumber(dvmBalanceAfter0))
      .toStrictEqual(new BigNumber(dvmBalanceBefore0).plus(3))

    // check evm balance to be equal to zero
    const withoutEthRes = await testing.rpc.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')
    const withEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth)).toStrictEqual(new BigNumber(withEth))
  })

  it.skip('should (duo) transfer domain from DVM to EVM', async () => {
    const dvmAccBefore = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceBefore0, tokenIdBefore0] = dvmAccBefore[0].split('@')

    const transferDomain: TransferDomain = {
      items: [{
        src:
        {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(2)
          },
          data: [0]
        },
        dst: {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(2)
          },
          data: [0]
        }
      },
      {
        src:
        {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(1.5)
          },
          data: [0]
        },
        dst: {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(1.5)
          },
          data: [0]
        }
      }
      ]
    }

    const txn = await builder.account.transferDomain(transferDomain, dvmScript)
    const outs = await sendTransaction(container, txn)
    const encoded: string = OP_CODES.OP_DEFI_TX_TRANSFER_DOMAIN(transferDomain).asBuffer().toString('hex')
    const expectedTransferDomainScript = `6a${encoded}`

    expect(outs.length).toStrictEqual(2)
    expect(outs[0].value).toStrictEqual(0)
    expect(outs[0].n).toStrictEqual(0)
    expect(outs[0].tokenId).toStrictEqual(0)
    expect(outs[0].scriptPubKey.asm.startsWith('OP_RETURN 4466547838')).toStrictEqual(true)
    expect(outs[0].scriptPubKey.hex).toStrictEqual(expectedTransferDomainScript)
    expect(outs[0].scriptPubKey.type).toStrictEqual('nulldata')

    expect(outs[1].value).toEqual(expect.any(Number))
    expect(outs[1].n).toStrictEqual(1)
    expect(outs[1].tokenId).toStrictEqual(0)
    expect(outs[1].scriptPubKey.type).toStrictEqual('witness_v0_keyhash')
    expect(outs[1].scriptPubKey.addresses[0]).toStrictEqual(dvmAddr)

    const dvmAccAfter = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceAfter0, tokenIdAfter0] = dvmAccAfter[0].split('@')
    expect(tokenIdBefore0).toStrictEqual(tokenIdAfter0)

    // check: dvm balance is transferred
    expect(new BigNumber(dvmBalanceAfter0))
      .toStrictEqual(new BigNumber(dvmBalanceBefore0).minus(2 + 1.5))

    // check: evm balance = dvm balance - transferred
    const withoutEthRes = await testing.rpc.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth))
      .toStrictEqual(new BigNumber(withEth).minus(2 + 1.5))
  })

  it.skip('should (duo) transfer domain from EVM to DVM', async () => {
    const dvmAccBefore = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceBefore0, tokenIdBefore0] = dvmAccBefore[0].split('@')

    const transferDomain: TransferDomain = {
      items: [{
        src:
        {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(2)
          },
          data: [0]
        },
        dst: {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(2)
          },
          data: [0]
        }
      },
      {
        src:
        {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(1.5)
          },
          data: [0]
        },
        dst: {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(1.5)
          },
          data: [0]
        }
      }
      ]
    }

    const txn = await builder.account.transferDomain(transferDomain, dvmScript)
    const outs = await sendTransaction(container, txn)
    const encoded: string = OP_CODES.OP_DEFI_TX_TRANSFER_DOMAIN(transferDomain).asBuffer().toString('hex')
    const expectedTransferDomainScript = `6a${encoded}`

    expect(outs.length).toStrictEqual(2)
    expect(outs[0].value).toStrictEqual(0)
    expect(outs[0].n).toStrictEqual(0)
    expect(outs[0].tokenId).toStrictEqual(0)
    expect(outs[0].scriptPubKey.asm.startsWith('OP_RETURN 4466547838')).toStrictEqual(true)
    expect(outs[0].scriptPubKey.hex).toStrictEqual(expectedTransferDomainScript)
    expect(outs[0].scriptPubKey.type).toStrictEqual('nulldata')

    expect(outs[1].value).toEqual(expect.any(Number))
    expect(outs[1].n).toStrictEqual(1)
    expect(outs[1].tokenId).toStrictEqual(0)
    expect(outs[1].scriptPubKey.type).toStrictEqual('witness_v0_keyhash')
    expect(outs[1].scriptPubKey.addresses[0]).toStrictEqual(dvmAddr)

    const dvmAccAfter = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceAfter0, tokenIdAfter0] = dvmAccAfter[0].split('@')
    expect(tokenIdBefore0).toStrictEqual(tokenIdAfter0)

    expect(new BigNumber(dvmBalanceAfter0))
      .toStrictEqual(new BigNumber(dvmBalanceBefore0).plus(2 + 1.5))

    const withoutEthRes = await testing.rpc.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth)).toStrictEqual(new BigNumber(withEth))
  })

  it.skip('should (duo-diff) Transfer Domain from EVM to DVM and DVM to EVM', async () => {
    // transfer some to evm first
    {
      const transferDomain: TransferDomain = {
        items: [{
          src:
          {
            address: dvmScript,
            domain: TRANSFER_DOMAIN_TYPE.DVM,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            data: [0]
          },
          dst: {
            address: evmScript,
            domain: TRANSFER_DOMAIN_TYPE.EVM,
            amount: {
              token: 0,
              amount: new BigNumber(3)
            },
            data: [0]
          }
        }]
      }

      const txn = await builder.account.transferDomain(transferDomain, dvmScript)
      await sendTransaction(container, txn)
    }

    const dvmAccBefore = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceBefore0, tokenIdBefore0] = dvmAccBefore[0].split('@')

    // start
    const transferDomain: TransferDomain = {
      items: [{
        src:
        {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(4)
          },
          data: [0]
        },
        dst: {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(4)
          },
          data: [0]
        }
      },
      {
        src:
        {
          address: evmScript,
          domain: TRANSFER_DOMAIN_TYPE.EVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        },
        dst: {
          address: dvmScript,
          domain: TRANSFER_DOMAIN_TYPE.DVM,
          amount: {
            token: 0,
            amount: new BigNumber(3)
          },
          data: [0]
        }
      }
      ]
    }

    const txn = await builder.account.transferDomain(transferDomain, dvmScript)
    const outs = await sendTransaction(container, txn)
    const encoded: string = OP_CODES.OP_DEFI_TX_TRANSFER_DOMAIN(transferDomain).asBuffer().toString('hex')
    const expectedTransferDomainScript = `6a${encoded}`

    expect(outs.length).toStrictEqual(2)
    expect(outs[0].value).toStrictEqual(0)
    expect(outs[0].n).toStrictEqual(0)
    expect(outs[0].tokenId).toStrictEqual(0)
    expect(outs[0].scriptPubKey.asm.startsWith('OP_RETURN 4466547838')).toStrictEqual(true)
    expect(outs[0].scriptPubKey.hex).toStrictEqual(expectedTransferDomainScript)
    expect(outs[0].scriptPubKey.type).toStrictEqual('nulldata')

    expect(outs[1].value).toEqual(expect.any(Number))
    expect(outs[1].n).toStrictEqual(1)
    expect(outs[1].tokenId).toStrictEqual(0)
    expect(outs[1].scriptPubKey.type).toStrictEqual('witness_v0_keyhash')
    expect(outs[1].scriptPubKey.addresses[0]).toStrictEqual(dvmAddr)

    const dvmAccAfter = await testing.rpc.account.getAccount(dvmAddr)
    const [dvmBalanceAfter0, tokenIdAfter0] = dvmAccAfter[0].split('@')
    expect(tokenIdBefore0).toStrictEqual(tokenIdAfter0)

    // check: dvm balance is transferred
    expect(new BigNumber(dvmBalanceAfter0))
      .toStrictEqual(new BigNumber(dvmBalanceBefore0).plus(3 - 4))

    // check: evm balance = dvm balance - transferred
    const withoutEthRes = await testing.rpc.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await testing.rpc.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth).plus(4)).toStrictEqual(new BigNumber(withEth))
  })
})
