# Makefile — convenience wrappers around ansible-playbook.
# Override on the command line, e.g.:  make run LIMIT=petzko-lt-asus TAGS=packages

ANSIBLE_PLAYBOOK ?= ansible-playbook
PLAYBOOK         ?= site.yml
INVENTORY        ?= inventory/hosts.yml
LIMIT            ?=
TAGS             ?=

limit_arg := $(if $(LIMIT),--limit $(LIMIT),)
tags_arg  := $(if $(TAGS),--tags $(TAGS),)

.PHONY: help deps syntax lint check run list facts

help:
	@echo "Targets:"
	@echo "  deps    Install Galaxy collections from requirements.yml"
	@echo "  syntax  Syntax-check the playbook"
	@echo "  lint    Run yamllint + ansible-lint (must be installed)"
	@echo "  check   Dry-run the playbook (--check --diff)"
	@echo "  run     Apply the playbook (prompts for the sudo password)"
	@echo "  list    Show the inventory graph"
	@echo "  facts   Gather facts (use LIMIT=host to scope)"
	@echo ""
	@echo "Variables: PLAYBOOK, INVENTORY, LIMIT, TAGS"

deps:
	ansible-galaxy collection install -r requirements.yml

syntax:
	$(ANSIBLE_PLAYBOOK) $(PLAYBOOK) --syntax-check

lint:
	yamllint .
	ansible-lint

check:
	$(ANSIBLE_PLAYBOOK) $(PLAYBOOK) $(limit_arg) $(tags_arg) --check --diff --ask-become-pass

run:
	$(ANSIBLE_PLAYBOOK) $(PLAYBOOK) $(limit_arg) $(tags_arg) --ask-become-pass

list:
	ansible-inventory -i $(INVENTORY) --graph

facts:
	ansible $(if $(LIMIT),$(LIMIT),all) -m setup
