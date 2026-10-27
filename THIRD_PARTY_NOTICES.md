# Third-party notices

The root MIT license lets others use, modify, and redistribute this project's
code, including commercially, provided they retain the license and copyright
notice. It provides the code without warranty. Keep any existing third-party
license notices too; the root license does not override them.

- The Rayfin Universal App template under `app/` retains Microsoft's MIT license
  in [app/LICENSE](./app/LICENSE) and its source copyright headers.
- JavaScript dependencies retain their respective licenses. The frontend build
  generates `THIRD_PARTY_NOTICES.txt` in its build output through the existing
  `rollup-plugin-license` configuration.
- Native UDF dependencies (`fabric-user-data-functions`, `jsonpatch`, and
  `requests`) retain their respective licenses. They are configured for the Fabric
  runtime rather than vendored in this repository.
- Diagrams embed library assets from `microsoft-fabric-architecture-icons` and
  `architecture-diagram-components`, plus an Azure SRE Agent image from the supplied
  workflow diagram. The source libraries were supplied locally; their full
  distribution terms are not included here. Review asset redistribution rights
  before publishing or reusing the diagrams.
- Microsoft, Azure, Fabric, Rayfin, GitHub, and other names or logos are trademarks
  of their respective owners. The repository's code license does not grant
  trademark rights or imply endorsement.
