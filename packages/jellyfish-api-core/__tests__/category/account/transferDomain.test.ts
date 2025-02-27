import { MasterNodeRegTestContainer } from '@defichain/testcontainers'
import { ContainerAdapterClient } from '../../container_adapter_client'
import { TransferDomainType } from '../../../src/category/account'
import { RpcApiError } from '@defichain/jellyfish-api-core/dist/index'
import BigNumber from 'bignumber.js'

describe('TransferDomain', () => {
  let dvmAddr: string, evmAddr: string
  const container = new MasterNodeRegTestContainer()
  const client = new ContainerAdapterClient(container)

  beforeAll(async () => {
    await container.start()
    await container.waitForWalletCoinbaseMaturity()

    await client.masternode.setGov({
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
    await container.generate(2)

    dvmAddr = await container.call('getnewaddress', ['', 'bech32'])
    evmAddr = await container.getNewAddress('erc55', 'erc55')

    await container.call('utxostoaccount', [{ [dvmAddr]: '100@0' }])
    await container.generate(1)

    await container.call('createtoken', [{
      symbol: 'BTC',
      name: 'BTC',
      isDAT: true,
      mintable: true,
      tradeable: true,
      collateralAddress: dvmAddr
    }])
    await container.generate(1)

    await container.call('minttokens', ['10@BTC'])
    await container.generate(1)
  })

  afterAll(async () => {
    await container.stop()
  })

  describe('transferDomain failed', () => {
    it('should fail if transfer within same domain', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: dvmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Cannot transfer inside same domain')
    })

    it('should fail if amount is different', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '3@DFI', // diff
            domain: TransferDomainType.DVM
          },
          dst: {
            address: dvmAddr,
            amount: '46@DFI', // diff
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Source amount must be equal to destination amount')
    })

    it('should fail if transfer diff token', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: dvmAddr,
            amount: '3@BTC',
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Source token and destination token must be the same')
    })

    it('(dvm -> evm) should fail if source address and source domain are not match', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: evmAddr, // <- not match
            amount: '3@DFI',
            domain: TransferDomainType.DVM // <- not match
          },
          dst: {
            address: evmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Src address must be a legacy or Bech32 address in case of "DVM" domain')
    })

    it('(evm -> dvm) should fail if source address and source domain are not match', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr, // <- not match
            amount: '3@DFI',
            domain: TransferDomainType.EVM // <- not match
          },
          dst: {
            address: dvmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Src address must be an ERC55 address in case of "EVM" domain')
    })

    it('(dvm -> evm) should fail if destination address and destination domain are not match', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: dvmAddr, // <- not match
            amount: '3@DFI',
            domain: TransferDomainType.EVM // <- not match
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Dst address must be an ERC55 address in case of "EVM" domain')
    })

    it('(evm -> dvm) should fail if destination address and destination domain are not match', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: evmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.EVM
          },
          dst: {
            address: evmAddr, // <- not match
            amount: '3@DFI',
            domain: TransferDomainType.DVM // <- not match
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Dst address must be a legacy or Bech32 address in case of "DVM" domain')
    })

    it('(dvm -> evm) should fail if address is invalid', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: 'invalid',
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: evmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('recipient (invalid) does not refer to any valid address')
    })

    it('(evm -> dvm) should fail if address is invalid', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: evmAddr,
            amount: '3@DFI',
            domain: TransferDomainType.EVM
          },
          dst: {
            address: 'invalid',
            amount: '3@DFI',
            domain: TransferDomainType.DVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('recipient (invalid) does not refer to any valid address')
    })

    it('(dvm -> evm) should fail if insufficient balance', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '999@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: evmAddr,
            amount: '999@DFI',
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('amount 100.00000000 is less than 999.00000000')
    })

    it('(evm -> dvm) should fail if insufficient balance', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: evmAddr,
            amount: '999@DFI',
            domain: TransferDomainType.EVM
          },
          dst: {
            address: dvmAddr,
            amount: '999@DFI',
            domain: TransferDomainType.DVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow(`Not enough balance in ${evmAddr} to cover "EVM" domain transfer`)
    })

    it('(dvm -> evm) should fail if negative amount', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: dvmAddr,
            amount: '-1@DFI',
            domain: TransferDomainType.DVM
          },
          dst: {
            address: evmAddr,
            amount: '-1@DFI',
            domain: TransferDomainType.EVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Amount out of range')
    })

    it('(evm -> dvm) should fail if negative amount', async () => {
      const promise = client.account.transferDomain([
        {
          src: {
            address: evmAddr,
            amount: '-1@DFI',
            domain: TransferDomainType.EVM
          },
          dst: {
            address: dvmAddr,
            amount: '-1@DFI',
            domain: TransferDomainType.DVM
          }
        }
      ])
      await expect(promise).rejects.toThrow(RpcApiError)
      await expect(promise).rejects.toThrow('Amount out of range')
    })
  })

  it('should Transfer Domain from DVM to EVM', async () => {
    const dvmAcc = await client.account.getAccount(dvmAddr)
    const [dvmBalance0, tokenId0] = dvmAcc[0].split('@')

    const txid = await client.account.transferDomain([
      {
        src: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        },
        dst: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        }
      }
    ])
    expect(typeof txid).toStrictEqual('string')
    expect(txid.length).toStrictEqual(64)
    await container.generate(1)

    const dvmAcc1 = await client.account.getAccount(dvmAddr)
    const [dvmBalance1, tokenId1] = dvmAcc1[0].split('@')
    expect(tokenId1).toStrictEqual(tokenId0)

    // check: dvm balance is transferred
    expect(new BigNumber(dvmBalance1))
      .toStrictEqual(new BigNumber(dvmBalance0).minus(3))

    // check: evm balance = dvm balance - transferred
    const withoutEthRes = await client.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await client.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth))
      .toStrictEqual(new BigNumber(withEth).minus(3))
  })

  it('should Transfer Domain from EVM to DVM', async () => {
    const dvmAcc = await client.account.getAccount(dvmAddr)
    const [dvmBalance0, tokenId0] = dvmAcc[0].split('@')

    const txid = await client.account.transferDomain([
      {
        src: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        },
        dst: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        }
      }
    ])
    expect(typeof txid).toStrictEqual('string')
    expect(txid.length).toStrictEqual(64)

    await container.generate(1)

    const dvmAcc1 = await client.account.getAccount(dvmAddr)
    const [dvmBalance1, tokenId1] = dvmAcc1[0].split('@')
    expect(tokenId1).toStrictEqual(tokenId0)
    expect(new BigNumber(dvmBalance1))
      .toStrictEqual(new BigNumber(dvmBalance0).plus(3))

    // check eth balance to be equal to zero
    const withoutEthRes = await client.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')
    const withEthRes = await client.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth)).toStrictEqual(new BigNumber(withEth))
  })

  it.skip('should (duo) Transfer Domain from DVM to EVM', async () => {
    const dvmAcc = await client.account.getAccount(dvmAddr)
    const [dvmBalance0, tokenId0] = dvmAcc[0].split('@')

    const txid = await client.account.transferDomain([
      {
        src: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        },
        dst: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        }
      },
      {
        src: {
          address: dvmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.DVM
        },
        dst: {
          address: evmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.EVM
        }
      }
    ])
    expect(typeof txid).toStrictEqual('string')
    expect(txid.length).toStrictEqual(64)
    await container.generate(1)

    const dvmAcc1 = await client.account.getAccount(dvmAddr)
    const [dvmBalance1, tokenId1] = dvmAcc1[0].split('@')
    expect(tokenId1).toStrictEqual(tokenId0)

    // check: dvm balance is transferred
    expect(new BigNumber(dvmBalance1))
      .toStrictEqual(new BigNumber(dvmBalance0).minus(3 + 4))

    // check: evm balance = dvm balance - transferred
    const withoutEthRes = await client.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')

    const withEthRes = await client.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth))
      .toStrictEqual(new BigNumber(withEth).minus(3 + 4))
  })

  it.skip('should (duo) Transfer Domain from EVM to DVM', async () => {
    const dvmAcc = await client.account.getAccount(dvmAddr)
    const [dvmBalance0, tokenId0] = dvmAcc[0].split('@')

    const txid = await client.account.transferDomain([
      {
        src: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        },
        dst: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        }
      },
      {
        src: {
          address: evmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.EVM
        },
        dst: {
          address: dvmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.DVM
        }
      }
    ])
    expect(typeof txid).toStrictEqual('string')
    expect(txid.length).toStrictEqual(64)

    await container.generate(1)

    const dvmAcc1 = await client.account.getAccount(dvmAddr)
    const [dvmBalance1, tokenId1] = dvmAcc1[0].split('@')
    expect(tokenId1).toStrictEqual(tokenId0)
    expect(new BigNumber(dvmBalance1))
      .toStrictEqual(new BigNumber(dvmBalance0).plus(3 + 4))

    // check eth balance to be equal to zero
    const withoutEthRes = await client.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')
    const withEthRes = await client.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth)).toStrictEqual(new BigNumber(withEth))
  })

  it.skip('should (duo-diff) Transfer Domain from EVM to DVM and DVM to EVM', async () => {
    // transfer some to evm first
    await client.account.transferDomain([
      {
        src: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        },
        dst: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        }
      }
    ])
    await container.generate(1)

    const dvmAcc = await client.account.getAccount(dvmAddr)
    const [dvmBalance0, tokenId0] = dvmAcc[0].split('@')

    // start
    const txid = await client.account.transferDomain([
      {
        src: {
          address: dvmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.DVM
        },
        dst: {
          address: evmAddr,
          amount: '4@DFI',
          domain: TransferDomainType.EVM
        }
      },
      {
        src: {
          address: evmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.EVM
        },
        dst: {
          address: dvmAddr,
          amount: '3@DFI',
          domain: TransferDomainType.DVM
        }
      }
    ])
    expect(typeof txid).toStrictEqual('string')
    expect(txid.length).toStrictEqual(64)

    await container.generate(1)

    const dvmAcc1 = await client.account.getAccount(dvmAddr)
    const [dvmBalance1, tokenId1] = dvmAcc1[0].split('@')
    expect(tokenId1).toStrictEqual(tokenId0)
    expect(new BigNumber(dvmBalance1))
      .toStrictEqual(new BigNumber(dvmBalance0).plus(3 - 4))

    // check eth balance to be equal to zero
    const withoutEthRes = await client.account.getTokenBalances({}, false)
    const [withoutEth] = withoutEthRes[0].split('@')
    const withEthRes = await client.account.getTokenBalances({}, false, { symbolLookup: false, includeEth: true })
    const [withEth] = withEthRes[0].split('@')
    expect(new BigNumber(withoutEth).plus(4)).toStrictEqual(new BigNumber(withEth))
  })
})
