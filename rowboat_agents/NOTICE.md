# Attribution to OpenAI Swarm

- The Rowboat Agents framework has been built upon [OpenAI Swarm](https://github.com/openai/swarm), with modifications and improvements.
- The original OpenAI Swarm is available under the [MIT license](https://github.com/openai/swarm/blob/main/LICENSE) as of the time of this writing. It is an experimental sample framework at the time of this writing.

### OpenAI Swarm License
Below is the license text from OpenAI Swarm, as required by the MIT license:

```
MIT License

Copyright (c) 2024 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

# High-level changes
These are the high-level changes made to OpenAI Swarm to build in RowBoat's custom implementation:
- Added localized agent-level history
- Added parent-child agent relationships with parents' history containing children's history
- Added usage tracking of tokens per llm
- Added turn-level error handling
- Added converstaion turn limits
- Removed streaming support as RowBoat Agents does not support streaming currently
- Modified the `Agent` and `Response` classes to be more comprehensive

The above is not an exhaustive list.