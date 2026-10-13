# Contributing to OpenLogs

Bug reports, ideas and pull requests are welcome.

- Branch off `development` and open the pull request against `development`. `main` holds the latest release and only receives merges from `development`.
- Run the tests before opening a pull request:

  ```sh
  cargo test --workspace
  npm --prefix ui test
  ```

- Never add real combat logs or real character names to the repository; test fixtures use made-up names.

## Contributor license agreement

OpenLogs is licensed under the GNU Affero General Public License, version 3 or later. The copyleft is there so that nobody can build a closed-source product on OpenLogs and keep their improvements to themselves. Wine went through this: while it was under a permissive license, TransGaming built its proprietary WineX on Wine's code, and its DirectX work did not flow back into Wine. Concern about such forks led Wine to switch to the LGPL in 2002.

Copyleft has its downsides too. If the community comes to prefer a permissive license such as MIT or Apache-2.0, OpenLogs should be able to switch. Without an agreement, that would mean asking every contributor for permission or removing their code. That is why every pull request asks you to agree to the following terms. They apply to everything you submit to this repository ("your contribution").

1. **Copyright license.** You grant Shaydera a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, publicly display, publicly perform, distribute and sublicense your contribution and works based on it, under any license terms, including the GNU Affero General Public License and other open source licenses.
2. **Patent license.** You grant Shaydera and everyone who receives OpenLogs a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license under any patent claims you can license that your contribution, alone or combined with OpenLogs, would infringe, to make, use, sell, offer for sale, import and otherwise transfer OpenLogs.
3. **You keep your rights.** You keep the copyright in your contribution and may use it in any other way you like.
4. **Your right to contribute.** Your contribution is your own work, or you have the right to submit it under these terms. If your employer or anyone else has rights in your contribution, they have allowed you to submit it under these terms.
5. **No warranty.** Your contribution comes as is, without any warranty, and you are not obliged to support it.
